/**
 * Agent 消息角色枚举。
 *
 * 使用方：
 * - `AgentMessage.role`
 * - `Agent.run()` 会写入 `user` / `assistant` / `tool`
 * - `model.ts` 会在格式转换时读取该值
 */
export type AgentRole = "system" | "user" | "assistant" | "tool";

/**
 * 轻量 JSON Schema 定义。
 *
 * 设计目的：
 * - 给工具参数描述提供最小必需的 schema 能力。
 * - 当前主要用于向 OpenAI 兼容模型声明工具输入结构。
 *
 * 使用方：
 * - `ToolDefinition.inputSchema`
 * - `tools.ts` 中各工具定义
 * - `model.ts` 中 `toOpenAITool()`
 */
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

/**
 * 工具元信息。
 *
 * 使用方：
 * - `Tool.definition`
 * - `ToolRegistry.getDefinitions()`
 * - `model.ts -> toOpenAITool()`
 */
export interface ToolDefinition {
  /** 工具名，要求唯一。模型返回工具调用时靠这个名字匹配。 */
  name: string;
  /** 给模型看的说明文本，帮助模型理解该工具的用途。 */
  description: string;
  /** 参数结构定义，只允许 object 作为工具入参根节点。 */
  inputSchema: Extract<JsonSchema, { type: "object" }>;
}

/**
 * 模型返回的一次工具调用请求。
 *
 * 产生方：
 * - `OpenAICompatibleChatModel.generate()` 解析模型响应后构造。
 *
 * 消费方：
 * - `Agent.run()` 遍历这些调用。
 * - `ToolRegistry.execute()` 根据 name 执行工具。
 */
export interface ToolCall {
  /** 工具调用唯一 ID，用于把 tool response 关联回对应调用。 */
  id: string;
  /** 需要执行的工具名。 */
  name: string;
  /** 解析后的工具参数对象。 */
  arguments: Record<string, unknown>;
  /** 原始参数文本，便于调试或在解析失败时返回更明确错误。 */
  rawArguments?: string;
  /** 参数解析失败时的错误信息。 */
  argumentsParseError?: string;
}

/**
 * Agent 内部统一消息结构。
 *
 * 使用范围：
 * - `ConversationMemory` 保存它。
 * - `Agent.run()` 读写它。
 * - `model.ts` 负责和 OpenAI 消息结构互相转换。
 * - `App.tsx` 会把最终结果映射成前端展示消息。
 */
export interface AgentMessage {
  /** 可选消息 ID，方便前端在流式更新时稳定定位同一条消息。 */
  id?: string;
  /** 消息角色。 */
  role: AgentRole;
  /** 文本内容。对 tool 消息来说通常是 JSON 字符串。 */
  content: string;
  /** 可选名称。tool 消息常用来记录工具名。 */
  name?: string;
  /** 当 role=tool 时，用来指明这条结果对应哪个 tool call。 */
  toolCallId?: string;
  /** 当 role=assistant 且模型发起过工具调用时，会挂在这里。 */
  toolCalls?: ToolCall[];
}

/**
 * 一次模型生成请求的输入参数。
 *
 * 调用方：
 * - `Agent.run()` 构造并传给 `ChatModel.generate()`。
 */
export interface ModelGenerateParams {
  /** 完整上下文消息列表。 */
  messages: AgentMessage[];
  /** 当前允许模型调用的工具定义列表。 */
  tools: ToolDefinition[];
  /** 可选系统提示词。 */
  systemPrompt?: string;
  /** 最大输出 token。 */
  maxTokens?: number;
  /** 采样温度。 */
  temperature?: number;
  /** 允许外部中断模型请求。 */
  signal?: AbortSignal;
  /** 流式文本增量回调。 */
  onTextDelta?: (delta: string) => void;
}

/**
 * 一次模型生成的返回结果。
 *
 * 产生方：
 * - `OpenAICompatibleChatModel.generate()`
 *
 * 消费方：
 * - `Agent.run()`
 */
export interface ModelGenerateResult {
  /** 模型返回的 assistant 消息。 */
  message: AgentMessage;
  /** 本次生成为什么结束。 */
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown";
  /** 原始响应，方便调试或扩展。 */
  raw?: unknown;
}

/**
 * Agent 执行参数。
 *
 * 调用方：
 * - `src/App.tsx` 当前只传入默认空对象。
 * - 后续可用于高级控制，如限制 maxSteps 或覆盖 systemPrompt。
 */
export interface AgentRunOptions {
  /** 最多允许执行多少轮模型推理。默认 20。 */
  maxSteps?: number;
  /** 本次运行临时覆盖系统提示词。 */
  systemPrompt?: string;
  /** 本次运行临时覆盖温度。 */
  temperature?: number;
  /** 本次运行临时覆盖最大输出长度。 */
  maxTokens?: number;
  /** 允许外部中断当前整轮运行。 */
  signal?: AbortSignal;
  /** 运行期间的流式事件通知。 */
  onEvent?: (event: AgentRunEvent) => void;
}

export type AgentRunEvent =
  | {
      type: "assistant_step_start";
      step: number;
      messageId: string;
    }
  | {
      type: "assistant_text_delta";
      step: number;
      messageId: string;
      delta: string;
      content: string;
    }
  | {
      type: "assistant_message_complete";
      step: number;
      messageId: string;
      message: AgentMessage;
    }
  | {
      type: "tool_message";
      step: number;
      message: AgentMessage;
    };

/**
 * Agent 最终执行结果。
 *
 * 产生方：
 * - `Agent.run()`
 *
 * 消费方：
 * - `src/App.tsx` 在界面上把完整消息流渲染出来。
 */
export interface AgentRunResult {
  /** 最终回答文本。 */
  output: string;
  /** 一共执行了多少轮。 */
  steps: number;
  /** 包含 user / assistant / tool 的完整消息历史。 */
  messages: AgentMessage[];
}
