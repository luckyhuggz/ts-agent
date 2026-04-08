import type {
  AgentMessage,
  ModelGenerateParams,
  ModelGenerateResult,
  ToolCall,
  ToolDefinition
} from "./types.js";

/** 抽象「一次对话补全」：输入消息与工具定义，输出助手消息与结束原因。 */
export interface ChatModel {
  generate(params: ModelGenerateParams): Promise<ModelGenerateResult>;
}

export interface OpenAICompatibleChatModelOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

/** 通过 `fetch` 调用 OpenAI 兼容的 `POST /chat/completions`，解析 assistant 文本与 `tool_calls`。 */
export class OpenAICompatibleChatModel implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;

  constructor(options: OpenAICompatibleChatModelOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
    this.headers = options.headers ?? {};
  }

  /** 组装 messages/tools，请求接口并规范化 content、tool_calls 与 finish_reason。 */
  async generate(params: ModelGenerateParams): Promise<ModelGenerateResult> {
    // 这里直接走原生 fetch，请求 OpenAI 兼容的 chat completions 接口。
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.headers
      },
      body: JSON.stringify({
        model: this.model,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens,
        messages: toOpenAIMessages(params.messages, params.systemPrompt),
        tools: params.tools.map(toOpenAITool),
        tool_choice: params.tools.length > 0 ? "auto" : undefined
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Model request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error("Model response did not include a message.");
    }

    const toolCalls = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `tool_${index}`,
      name: call.function?.name ?? "unknown_tool",
      // 工具参数由模型返回 JSON 字符串，这里解析成普通对象。
      arguments: safeParseArgs(call.function?.arguments)
    }));

    return {
      message: {
        role: "assistant",
        content: normalizeContent(message.content),
        toolCalls
      },
      finishReason: normalizeFinishReason(choice?.finish_reason, toolCalls),
      raw: data
    };
  }
}

/** 不发起网络请求的占位模型，按关键词模拟 tool calling，便于本地联调 Agent 流程。 */
export class MockModel implements ChatModel {
  /** 根据末条用户消息关键词返回固定 tool_calls 或最终说明文本。 */
  async generate(params: ModelGenerateParams): Promise<ModelGenerateResult> {
    const lastMessage = [...params.messages].reverse()[0];

    if (
      lastMessage?.role === "user" &&
      /时间|几点|当前时间|time/i.test(lastMessage.content) &&
      params.tools.some((tool) => tool.name === "get_current_time")
    ) {
      return {
        message: {
          role: "assistant",
          content: "我先获取当前时间。",
          toolCalls: [
            {
              id: "tool_time_1",
              name: "get_current_time",
              arguments: {}
            }
          ]
        },
        finishReason: "tool_calls"
      };
    }

    if (
      lastMessage?.role === "user" &&
      /计算|算一下|calculate/i.test(lastMessage.content) &&
      params.tools.some((tool) => tool.name === "calculate")
    ) {
      const expression = extractExpression(lastMessage.content);
      return {
        message: {
          role: "assistant",
          content: "我来计算一下。",
          toolCalls: [
            {
              id: "tool_calc_1",
              name: "calculate",
              arguments: { expression }
            }
          ]
        },
        finishReason: "tool_calls"
      };
    }

    if (lastMessage?.role === "tool") {
      return {
        message: {
          role: "assistant",
          content: `工具执行完成，结果如下：${lastMessage.content}`
        },
        finishReason: "stop"
      };
    }

    return {
      message: {
        role: "assistant",
        content: "这是 MockModel 的默认回复。你可以把它替换成 OpenAICompatibleChatModel。"
      },
      finishReason: "stop"
    };
  }
}

/** 从用户句末截取看起来像算式的片段，供 Mock 计算器工具使用。 */
function extractExpression(content: string): string {
  const match = content.match(/([-+*/().\d\s]+)$/);
  return match?.[1]?.trim() || "1 + 1";
}

/** 将内部 `AgentMessage` 转为 API 所需的 message 数组（含 system、tool、带 tool_calls 的 assistant）。 */
function toOpenAIMessages(messages: AgentMessage[], systemPrompt?: string): Array<Record<string, unknown>> {
  const baseMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }]
    : [];

  return [
    ...baseMessages,
    ...messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name
        };
      }

      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments)
            }
          }))
        };
      }

      return {
        role: message.role,
        content: message.content,
        name: message.name
      };
    })
  ];
}

/** 将 `ToolDefinition` 映射为 OpenAI tools 项（`type: function` + parameters）。 */
function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  };
}

/** 将 API 返回的字符串或多段 text part 合并为单一 assistant 文本。 */
function normalizeContent(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }

  return "";
}

/** 解析模型返回的工具参数字符串；非法 JSON 时返回空对象，避免中断主流程。 */
function safeParseArgs(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText);
    return isRecord(parsed) ? parsed : {};
  } catch {
    // 模型偶尔会输出非法 JSON，这里兜底为空对象，避免主循环崩掉。
    return {};
  }
}

/** 有 tool_calls 时统一视为 `tool_calls`；否则映射已知 finish_reason，未知则 `unknown`。 */
function normalizeFinishReason(
  finishReason: string | null | undefined,
  toolCalls: ToolCall[]
): ModelGenerateResult["finishReason"] {
  if (toolCalls.length > 0) {
    return "tool_calls";
  }

  switch (finishReason) {
    case "stop":
    case "length":
    case "content_filter":
      return finishReason;
    default:
      return "unknown";
  }
}

/** 类型守卫：判断是否为普通对象（非 null、非数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
