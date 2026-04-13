import type {
  AgentMessage,
  ModelGenerateParams,
  ModelGenerateResult,
  ToolCall,
  ToolDefinition,
} from "./types";
import { httpFetch, httpFetchStream } from "@/lib/desktop";

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

interface OpenAIChatCompletionChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
      tool_calls?: Array<{
        index?: number;
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
    const safeMaxTokens = normalizeMaxTokensForModel(this.model, params.maxTokens);
    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...this.extraHeaders,
    };
    const requestBody = {
      model: this.model,
      temperature: 1,
      max_tokens: safeMaxTokens,
      messages: toOpenAIMessages(params.messages, params.systemPrompt),
      tools: params.tools.map(toOpenAITool),
      tool_choice: params.tools.length > 0 ? "auto" : undefined,
    };

    try {
      return await this.generateStream({
        ...params,
        requestHeaders,
        requestBody,
      });
    } catch (error) {
      if (!shouldFallbackToNonStreaming(error)) {
        throw error;
      }

      return this.generateNonStreaming({
        ...params,
        requestHeaders,
        requestBody,
      });
    }
  }

  private async generateNonStreaming(
    params: ModelGenerateParams & {
      requestHeaders: Record<string, string>;
      requestBody: Record<string, unknown>;
    },
  ): Promise<ModelGenerateResult> {
    const response = await httpFetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: params.requestHeaders,
      body: JSON.stringify(params.requestBody),
      signal: params.signal,
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

    const content = normalizeContent(message.content);
    if (content) {
      params.onTextDelta?.(content);
    }

    const toolCalls = (message.tool_calls ?? []).map((call, index) => {
      const parsedArgs = parseToolArguments(call.function?.arguments, choice?.finish_reason);
      return {
        id: call.id ?? `tool_${index}`,
        name: call.function?.name ?? "unknown_tool",
        arguments: parsedArgs.arguments,
        rawArguments: call.function?.arguments,
        argumentsParseError: parsedArgs.error,
      };
    });

    return {
      message: {
        role: "assistant",
        content,
        toolCalls,
      },
      finishReason: normalizeFinishReason(choice?.finish_reason, toolCalls),
      raw: data,
    };
  }

  private async generateStream(
    params: ModelGenerateParams & {
      requestHeaders: Record<string, string>;
      requestBody: Record<string, unknown>;
    },
  ): Promise<ModelGenerateResult> {
    let buffer = "";
    let content = "";
    let finishReason: string | null | undefined;
    const toolCallStates: Array<{
      id?: string;
      name?: string;
      argumentsText: string;
    }> = [];

    await httpFetchStream(
      `${this.baseURL}/chat/completions`,
      {
        method: "POST",
        headers: params.requestHeaders,
        body: JSON.stringify({
          ...params.requestBody,
          stream: true,
        }),
        signal: params.signal,
      },
      {
        onChunk: (chunk) => {
          buffer += chunk;
          const consumed = consumeSseBuffer(buffer, (payload) => {
            const choice = payload.choices?.[0];
            if (!choice) return;

            finishReason = choice.finish_reason ?? finishReason;
            const delta = choice.delta;
            const nextText = normalizeContent(delta?.content);

            if (nextText) {
              content += nextText;
              params.onTextDelta?.(nextText);
            }

            for (const toolCall of delta?.tool_calls ?? []) {
              const index = toolCall.index ?? 0;
              const current =
                toolCallStates[index] ??
                (toolCallStates[index] = {
                  id: `tool_${index}`,
                  name: "unknown_tool",
                  argumentsText: "",
                });

              if (toolCall.id) {
                current.id = toolCall.id;
              }
              if (toolCall.function?.name) {
                current.name = toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                current.argumentsText += toolCall.function.arguments;
              }
            }
          });

          buffer = buffer.slice(consumed);
        },
      },
    );

    if (buffer.trim()) {
      consumeSseBuffer(buffer, (payload) => {
        const choice = payload.choices?.[0];
        if (!choice) return;

        finishReason = choice.finish_reason ?? finishReason;
      }, true);
    }

    const toolCalls = toolCallStates
      .filter((toolCall): toolCall is NonNullable<typeof toolCall> => Boolean(toolCall))
      .map((toolCall, index) => {
        const parsedArgs = parseToolArguments(toolCall.argumentsText, finishReason);
        return {
          id: toolCall.id ?? `tool_${index}`,
          name: toolCall.name ?? "unknown_tool",
          arguments: parsedArgs.arguments,
          rawArguments: toolCall.argumentsText,
          argumentsParseError: parsedArgs.error,
        };
      });

    return {
      message: {
        role: "assistant",
        content,
        toolCalls,
      },
      finishReason: normalizeFinishReason(finishReason, toolCalls),
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

function normalizeMaxTokensForModel(model: string, maxTokens?: number): number | undefined {
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens)) {
    return undefined;
  }

  const normalized = Math.max(1, Math.floor(maxTokens));
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedModel === "deepseek-chat") {
    return Math.min(normalized, 8192);
  }

  return normalized;
}

function consumeSseBuffer(
  buffer: string,
  onPayload: (payload: OpenAIChatCompletionChunk) => void,
  flush = false,
): number {
  let offset = 0;

  while (true) {
    const separator = findSseSeparator(buffer, offset);
    const boundaryIndex = separator
      ? separator.index
      : flush
        ? buffer.length
        : -1;

    if (boundaryIndex < 0) {
      break;
    }

    const rawEvent = buffer.slice(offset, boundaryIndex);

    const eventPayload = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (!eventPayload || eventPayload === "[DONE]") {
      offset = separator ? boundaryIndex + separator.length : buffer.length;
      continue;
    }

    try {
      onPayload(JSON.parse(eventPayload) as OpenAIChatCompletionChunk);
    } catch {
      if (!flush) {
        return offset;
      }
    }

    offset = separator ? boundaryIndex + separator.length : buffer.length;
  }

  return offset;
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
function parseToolArguments(
  argumentsText: string | undefined,
  finishReason?: string | null,
): { arguments: Record<string, unknown>; error?: string } {
  if (!argumentsText) {
    return {
      arguments: {},
      error: "Tool arguments were empty.",
    };
  }

  const candidates = buildToolArgumentCandidates(argumentsText);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        continue;
      }
      return { arguments: parsed };
    } catch {
      // Try the next candidate.
    }
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!isRecord(parsed)) {
      return {
        arguments: {},
        error: "Tool arguments were not a JSON object.",
      };
    }
    return { arguments: parsed };
  } catch (error) {
    const reason =
      finishReason === "length"
        ? " The model output likely hit a length limit. Retry with smaller chunks or a shorter tool payload."
        : "";

    return {
      arguments: {},
      error: `Failed to parse tool arguments as JSON.${reason} Raw length=${argumentsText.length}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function buildToolArgumentCandidates(argumentsText: string): string[] {
  const trimmed = argumentsText.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  if (fenced) {
    candidates.push(fenced.trim());
  }

  const firstBraceIndex = trimmed.indexOf("{");
  const lastBraceIndex = trimmed.lastIndexOf("}");
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    candidates.push(trimmed.slice(firstBraceIndex, lastBraceIndex + 1));
  }

  return [...new Set(candidates.filter(Boolean))];
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

function shouldFallbackToNonStreaming(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("stream") &&
    (message.includes("unsupported") ||
      message.includes("not support") ||
      message.includes("not supported") ||
      message.includes("invalid"))
  );
}

function findSseSeparator(
  buffer: string,
  fromIndex: number,
): { index: number; length: number } | null {
  const crlfIndex = buffer.indexOf("\r\n\r\n", fromIndex);
  const lfIndex = buffer.indexOf("\n\n", fromIndex);

  if (crlfIndex < 0 && lfIndex < 0) {
    return null;
  }

  if (crlfIndex < 0) {
    return { index: lfIndex, length: 2 };
  }

  if (lfIndex < 0 || crlfIndex < lfIndex) {
    return { index: crlfIndex, length: 4 };
  }

  return { index: lfIndex, length: 2 };
}
