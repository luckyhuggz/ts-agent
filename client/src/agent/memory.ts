import type { AgentMessage } from "./types";

/** 维护多轮对话消息列表，供模型每次 `generate` 时作为完整上下文传入。 */
export class ConversationMemory {
  private readonly messages: AgentMessage[] = [];

  constructor(initialMessages: AgentMessage[] = []) {
    this.messages.push(...initialMessages);
  }

  add(message: AgentMessage): void {
    this.messages.push(message);
  }

  addMany(messages: AgentMessage[]): void {
    this.messages.push(...messages);
  }

  all(): AgentMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}
