import type { AgentMessage } from "./types.js";

/** 维护多轮对话消息列表，供模型每次 `generate` 时作为完整上下文传入。 */
export class ConversationMemory {
  private readonly messages: AgentMessage[] = [];

  constructor(initialMessages: AgentMessage[] = []) {
    this.messages.push(...initialMessages);
  }

  /** 追加单条消息。 */
  add(message: AgentMessage): void {
    this.messages.push(message);
  }

  /** 批量追加（例如一轮里多条 tool 结果）。 */
  addMany(messages: AgentMessage[]): void {
    this.messages.push(...messages);
  }

  /** 返回当前对话快照（浅拷贝数组，避免外部直接改内部数组引用）。 */
  all(): AgentMessage[] {
    // 返回副本，避免外部直接改写内部状态。
    return [...this.messages];
  }

  /** 清空历史，用于开启新会话。 */
  clear(): void {
    this.messages.length = 0;
  }
}
