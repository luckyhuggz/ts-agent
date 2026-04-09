import type {
  AgentMessage,
  ModelGenerateParams,
  ModelGenerateResult,
  ToolCall,
  ToolDefinition,
} from "./types";
import { httpFetch } from "@/lib/desktop";

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

export class OpenAICompatibleChatModel implements ChatModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleChatModelOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
    this.extraHeaders = options.headers ?? {};
  }

  async generate(params: ModelGenerateParams): Promise<ModelGenerateResult> {
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

function safeParseArgs(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) return {};
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
