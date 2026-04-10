import { ConversationMemory } from "./memory";
import type { ChatModel } from "./model";
import type { ToolRegistry } from "./tools";
import type { AgentMessage, AgentRunOptions, AgentRunResult } from "./types";

/**
 * Agent 构造参数。
 *
 * 调用方：
 * - 目前由 `src/App.tsx` 中的 `buildAgent()` 创建并传入。
 *
 * 被谁消费：
 * - 仅被当前文件中的 `Agent` 构造函数消费。
 */
export interface AgentOptions {
  /** 模型适配层，负责把消息发送给具体大模型。由 `Agent.run()` 调用其 `generate()`。 */
  model: ChatModel;
  /** 工具注册表，可选。若模型返回 tool calls，则由 `Agent.run()` 调用它执行工具。 */
  tools?: ToolRegistry;
  /** 对话记忆，可选。不传时自动创建新的 `ConversationMemory`。 */
  memory?: ConversationMemory;
  /** 默认系统提示词。若 `run()` 没有传入 `systemPrompt`，则使用这里的值。 */
  defaultSystemPrompt?: string;
}

/**
 * Agent 主控制器。
 *
 * 核心职责：
 * - 接收用户输入。
 * - 维护多轮上下文。
 * - 调用模型生成回复。
 * - 当模型请求工具时，执行工具并把结果继续喂回模型。
 * - 直到拿到最终自然语言答案，或达到最大步骤限制。
 *
 * 主要调用方：
 * - `src/App.tsx` 中的 `handleSend()` 会调用 `agent.run(text)`。
 *
 * 主要依赖：
 * - `ConversationMemory`：保存对话历史。
 * - `ChatModel.generate()`：向模型发起一次推理。
 * - `ToolRegistry.execute()`：执行模型请求的工具。
 */
export class Agent {
  private readonly model: ChatModel;
  private readonly tools?: ToolRegistry;
  private readonly memory: ConversationMemory;
  private readonly defaultSystemPrompt?: string;

  /**
   * 初始化 Agent。
   *
   * 调用方：
   * - `src/App.tsx` -> `buildAgent()`。
   *
   * 内部行为：
   * - 保存模型实例与工具注册表引用。
   * - 如果外部没有传 memory，则创建一个新的空会话记忆。
   */
  constructor(options: AgentOptions) {
    this.model = options.model;
    this.tools = options.tools;
    this.memory = options.memory ?? new ConversationMemory();
    this.defaultSystemPrompt = options.defaultSystemPrompt;
  }

  /**
   * 执行一次完整的 Agent 对话流程。
   *
   * 调用方：
   * - `src/App.tsx` 中用户发送消息时调用。
   *
   * 调用了谁：
   * - `this.memory.add()`：先把用户输入写入上下文。
   * - `this.model.generate()`：每一轮向模型请求下一步动作。
   * - `this.memory.add()` / `this.memory.addMany()`：写入 assistant/tool 消息。
   * - `this.tools.execute()`：当模型请求工具时逐个执行。
   * - `this.memory.all()`：返回完整对话历史给界面展示。
   *
   * 执行流程：
   * 1. 记录用户消息。
   * 2. 循环调用模型，最多执行 `maxSteps` 步。
   * 3. 若模型直接返回普通回答，则结束。
   * 4. 若模型返回工具调用，则执行工具，把工具结果作为 tool message 写回上下文。
   * 5. 再次进入下一轮模型推理，直到得到最终回答。
   */
  async run(input: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    /** 最大推理轮数，避免模型反复请求工具导致无限循环。 */
    const maxSteps = options.maxSteps ?? 8;
    /** 优先使用本次调用显式传入的系统提示词，否则回退到构造时的默认值。 */
    const systemPrompt = options.systemPrompt ?? this.defaultSystemPrompt;

    // 第一步：先把用户输入加入记忆。后续模型看到的是完整上下文而不是单条消息。
    this.memory.add({ role: "user", content: input });

    // 从第 1 步开始迭代，直到模型给出最终答案或超过上限。
    for (let step = 1; step <= maxSteps; step += 1) {
      // 每轮都把当前完整上下文、可用工具定义和生成参数交给模型。
      const result = await this.model.generate({
        messages: this.memory.all(),
        tools: this.tools?.getDefinitions() ?? [],
        systemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });

      // 模型返回的 assistant 消息先写入记忆，后面 UI 和下一轮推理都会用到。
      this.memory.add(result.message);

      // 如果这一轮没有工具调用，说明模型已经给出最终自然语言答复，可以直接结束。
      const toolCalls = result.message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return {
          output: result.message.content,
          steps: step,
          messages: this.memory.all(),
        };
      }

      // 模型要求调工具，但当前 Agent 没有配置工具注册表，这是非法状态，直接抛错。
      if (!this.tools) {
        throw new Error("Model requested tool calls, but no ToolRegistry was configured.");
      }

      // 把每个工具调用的执行结果转换成标准 tool message，再统一写回 memory。
      const toolMessages: AgentMessage[] = [];
      for (const toolCall of toolCalls) {
        // 调用 `ToolRegistry.execute()` 按工具名分发执行。
        const execution = await this.tools.execute(toolCall);
        toolMessages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          // 这里把工具执行结果序列化成 JSON 字符串，供下轮模型继续理解和引用。
          content: JSON.stringify({ ok: execution.ok, result: execution.result }, null, 2),
        });
      }

      // 工具结果进入上下文后，下一轮模型就能看到“assistant 发起过什么工具调用”以及“工具返回了什么”。
      this.memory.addMany(toolMessages);
    }

    // 走到这里说明模型在允许的步数内始终没有产出最终回答。
    throw new Error(`Agent stopped after reaching maxSteps=${maxSteps} without a final answer.`);
  }

  /**
   * 获取当前完整历史。
   *
   * 调用方：
   * - 当前仓库中主要是调试/扩展场景可用。
   *
   * 调用了谁：
   * - `ConversationMemory.all()`。
   */
  history(): AgentMessage[] {
    return this.memory.all();
  }

  /**
   * 清空当前会话历史。
   *
   * 调用方：
   * - `src/App.tsx` 中切换模型配置或点击“清空对话”时调用。
   *
   * 调用了谁：
   * - `ConversationMemory.clear()`。
   */
  reset(): void {
    this.memory.clear();
  }
}
