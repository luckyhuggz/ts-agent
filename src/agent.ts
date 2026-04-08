import { ConversationMemory } from "./memory.js";
import type { ChatModel } from "./model.js";
import type { ToolRegistry } from "./tools.js";
import type { AgentMessage, AgentRunOptions, AgentRunResult } from "./types.js";

export interface AgentOptions {
  model: ChatModel;
  tools?: ToolRegistry;
  memory?: ConversationMemory;
  defaultSystemPrompt?: string;
}

/**
 * 组合 `ChatModel`、可选 `ToolRegistry` 与 `ConversationMemory`，
 * 实现「模型生成 → 若有 tool_calls 则执行工具 → 再生成」的循环直到得到纯文本回复或超出步数。
 */
export class Agent {
  private readonly model: ChatModel;
  private readonly tools?: ToolRegistry;
  private readonly memory: ConversationMemory;
  private readonly defaultSystemPrompt?: string;

  constructor(options: AgentOptions) {
    this.model = options.model;
    this.tools = options.tools;
    this.memory = options.memory ?? new ConversationMemory();
    this.defaultSystemPrompt = options.defaultSystemPrompt;
  }

  /**
   * 将用户输入写入记忆，在 `maxSteps` 内反复调用模型；若有工具调用则执行并写回 tool 消息后再续写。
   * 无工具调用时返回助手最终文本、步数与完整消息历史。
   */
  async run(input: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 8;
    const systemPrompt = options.systemPrompt ?? this.defaultSystemPrompt;

    // 把用户输入先写入记忆，再进入模型推理循环。
    this.memory.add({
      role: "user",
      content: input
    });

    for (let step = 1; step <= maxSteps; step += 1) {
      // 每一轮都把当前完整上下文和可用工具定义交给模型。
      const result = await this.model.generate({
        messages: this.memory.all(),
        tools: this.tools?.getDefinitions() ?? [],
        systemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature
      });

      this.memory.add(result.message);

      const toolCalls = result.message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return {
          output: result.message.content,
          steps: step,
          messages: this.memory.all()
        };
      }

      if (!this.tools) {
        throw new Error("Model requested tool calls, but no ToolRegistry was configured.");
      }

      const toolMessages: AgentMessage[] = [];
      for (const toolCall of toolCalls) {
        const execution = await this.tools.execute(toolCall);
        // 工具结果统一序列化为 tool message，便于下一轮模型继续消费。
        toolMessages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          content: JSON.stringify(
            {
              ok: execution.ok,
              result: execution.result
            },
            null,
            2
          )
        });
      }

      this.memory.addMany(toolMessages);
    }

    throw new Error(`Agent stopped after reaching maxSteps=${maxSteps} without a final answer.`);
  }

  /** 当前会话中的全部消息（与 `run` 返回的 `messages` 同源）。 */
  history(): AgentMessage[] {
    return this.memory.all();
  }

  /** 清空对话记忆，不影响已构造的 model/tools 配置。 */
  reset(): void {
    // 重置后可以开始一段全新的对话。
    this.memory.clear();
  }
}
