import type {
  AgentMessage,
  ModelGenerateParams,
  ModelGenerateResult,
  ToolCall,
  ToolDefinition,
} from "./types";
import { httpFetch } from "@/lib/desktop";

/**
 * 模型抽象接口。
 *
 * 调用方：
 * - `Agent.run()` 只依赖这个抽象，不直接依赖具体模型实现。
 *
 * 设计目的：
 * - 允许未来替换为别的模型提供商而不改 Agent 主循环。
 */
export interface ChatModel {
  /** 根据消息、工具定义和生成参数，生成下一条 assistant 消息。 */
  generate(params: ModelGenerateParams): Promise<ModelGenerateResult>;
}

/**
 * OpenAI 兼容模型的初始化参数。
 *
 * 调用方：
 * - `src/App.tsx` 中 `buildAgent()` 会读取用户配置并创建该对象。
 */
export interface OpenAICompatibleChatModelOptions {
  /** API Key，会被拼进 `Authorization: Bearer ...` 请求头。 */
  apiKey: string;
  /** 模型名称，例如 `gpt-4o-mini`、`deepseek-chat`。 */
  model: string;
  /** 接口基地址，默认是 OpenAI 官方 `/v1`。 */
  baseURL?: string;
  /** 额外请求头，给某些兼容网关预留。 */
  headers?: Record<string, string>;
}

/**
 * 仅覆盖当前项目真正用到的 OpenAI Chat Completions 响应结构。
 *
 * 说明：
 * - 这是内部类型，只给 `OpenAICompatibleChatModel.generate()` 和解析辅助函数使用。
 */
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

/**
 * OpenAI 兼容接口实现。
 *
 * 核心职责：
 * - 把内部 `AgentMessage` / `ToolDefinition` 转换为 OpenAI 接口格式。
 * - 发起 HTTP 请求。
 * - 把返回的 message / tool_calls 再转换回框架内部格式。
 *
 * 主要调用方：
 * - `Agent.run()` 会在每一轮中调用 `generate()`。
 *
 * 依赖：
 * - `httpFetch()`：由 `src/lib/desktop.ts` 提供。
 *   在 Electron 中会转成主进程 IPC 请求；在浏览器中退回原生 fetch。
 */
export class OpenAICompatibleChatModel implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly extraHeaders: Record<string, string>;

  /**
   * 保存模型连接参数。
   *
   * 调用方：
   * - `src/App.tsx` 中 `buildAgent()`。
   */
  constructor(options: OpenAICompatibleChatModelOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
    this.extraHeaders = options.headers ?? {};
  }

  /**
   * 向 OpenAI 兼容接口发起一次生成请求。
   *
   * 调用方：
   * - `Agent.run()` 每一轮都会调用它。
   *
   * 调用了谁：
   * - `httpFetch()`：发送 HTTP 请求。
   * - `toOpenAIMessages()`：转换消息格式。
   * - `toOpenAITool()`：转换工具定义。
   * - `normalizeContent()`：解析返回文本。
   * - `safeParseArgs()`：解析工具参数。
   * - `normalizeFinishReason()`：规范化结束原因。
   *
   * 返回值：
   * - 一条内部格式的 assistant 消息。
   * - 一组 toolCalls（如果模型请求了工具）。
   * - 原始响应 raw，便于后续调试。
   */
  async generate(params: ModelGenerateParams): Promise<ModelGenerateResult> {
    // 使用 OpenAI 兼容的 `/chat/completions` 接口；Electron 环境下该请求由主进程代理。
    const response = await httpFetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens,
        messages: toOpenAIMessages(params.messages, params.systemPrompt),
        tools: params.tools.map(toOpenAITool),
        tool_choice: params.tools.length > 0 ? "auto" : undefined,
      }),
    });

    // 非 2xx 直接抛错，把服务端原文带出去，方便前端错误提示。
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Model request failed (${response.status}): ${text}`);
    }

    // 当前实现只读取第一条 choice。
    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error("Model response did not include a message.");
    }

    // 把 OpenAI 的 tool_calls 转成框架内部统一的 ToolCall 结构。
    const toolCalls = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `tool_${index}`,
      name: call.function?.name ?? "unknown_tool",
      arguments: safeParseArgs(call.function?.arguments),
    }));

    return {
      message: {
        role: "assistant",
        content: normalizeContent(message.content),
        toolCalls,
      },
      finishReason: normalizeFinishReason(choice?.finish_reason, toolCalls),
      raw: data,
    };
  }
}

/**
 * 把内部消息数组转换成 OpenAI Chat Completions 所需的 messages 格式。
 *
 * 调用方：
 * - `OpenAICompatibleChatModel.generate()`。
 *
 * 处理要点：
 * - 可选插入 system message。
 * - tool 消息需要带上 `tool_call_id`。
 * - assistant 若发起过工具调用，需要把 `toolCalls` 转成 `tool_calls`。
 */
function toOpenAIMessages(
  messages: AgentMessage[],
  systemPrompt?: string
): Array<Record<string, unknown>> {
  const baseMessages = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  return [
    ...baseMessages,
    ...messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name,
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: message.role, content: message.content, name: message.name };
    }),
  ];
}

/**
 * 把内部工具定义转换成 OpenAI 兼容格式。
 *
 * 调用方：
 * - `OpenAICompatibleChatModel.generate()`。
 */
function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * 规范化模型返回的内容字段。
 *
 * 调用方：
 * - `OpenAICompatibleChatModel.generate()`。
 *
 * 说明：
 * - 某些模型返回纯字符串。
 * - 某些模型返回内容分片数组，这里只拼接其中的 text 片段。
 */
function normalizeContent(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

/**
 * 安全解析工具调用参数。
 *
 * 调用方：
 * - `OpenAICompatibleChatModel.generate()` 在解析 `message.tool_calls` 时调用。
 *
 * 容错策略：
 * - 空值返回空对象。
 * - JSON 解析失败返回空对象。
 * - 解析结果不是普通对象也返回空对象。
 */
function safeParseArgs(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) return {};
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 把模型厂商返回的结束原因，映射为框架内部有限集合。
 *
 * 调用方：
 * - `OpenAICompatibleChatModel.generate()`。
 *
 * 规则：
 * - 只要检测到工具调用，就优先视为 `tool_calls`。
 * - 否则尝试映射标准 finish reason。
 * - 其余未知值统一归为 `unknown`。
 */
function normalizeFinishReason(
  finishReason: string | null | undefined,
  toolCalls: ToolCall[]
): ModelGenerateResult["finishReason"] {
  if (toolCalls.length > 0) return "tool_calls";
  switch (finishReason) {
    case "stop":
    case "length":
    case "content_filter":
      return finishReason;
    default:
      return "unknown";
  }
}

/**
 * 判断一个值是不是“普通对象”。
 *
 * 调用方：
 * - `safeParseArgs()`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
