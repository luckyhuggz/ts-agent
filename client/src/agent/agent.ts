import { ConversationMemory } from "./memory";
import type { ChatModel } from "./model";
import type { ToolRegistry } from "./tools";
import type { AgentMessage, AgentRunOptions, AgentRunResult } from "./types";

export interface AgentOptions {
  model: ChatModel;
  tools?: ToolRegistry;
  memory?: ConversationMemory;
  defaultSystemPrompt?: string;
}

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

  async run(input: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxSteps = options.maxSteps ?? 8;
    const systemPrompt = options.systemPrompt ?? this.defaultSystemPrompt;

    this.memory.add({ role: "user", content: input });

    for (let step = 1; step <= maxSteps; step += 1) {
      const result = await this.model.generate({
        messages: this.memory.all(),
        tools: this.tools?.getDefinitions() ?? [],
        systemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });

      this.memory.add(result.message);

      const toolCalls = result.message.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return {
          output: result.message.content,
          steps: step,
          messages: this.memory.all(),
        };
      }

      if (!this.tools) {
        throw new Error("Model requested tool calls, but no ToolRegistry was configured.");
      }

      const toolMessages: AgentMessage[] = [];
      for (const toolCall of toolCalls) {
        const execution = await this.tools.execute(toolCall);
        toolMessages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          content: JSON.stringify({ ok: execution.ok, result: execution.result }, null, 2),
        });
      }

      this.memory.addMany(toolMessages);
    }

    throw new Error(`Agent stopped after reaching maxSteps=${maxSteps} without a final answer.`);
  }

  history(): AgentMessage[] {
    return this.memory.all();
  }

  reset(): void {
    this.memory.clear();
  }
}
