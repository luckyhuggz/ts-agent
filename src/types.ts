export type AgentRole = "system" | "user" | "assistant" | "tool";

export type JsonSchema =
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number"; description?: string }
  | { type: "integer"; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JsonSchema }
  | {
      type: "object";
      description?: string;
      properties?: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
    };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Extract<JsonSchema, { type: "object" }>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: AgentRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ModelGenerateParams {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelGenerateResult {
  message: AgentMessage;
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown";
  raw?: unknown;
}

export interface AgentRunOptions {
  maxSteps?: number;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentRunResult {
  output: string;
  steps: number;
  messages: AgentMessage[];
}
