import type { AgentMessage } from "./types";

/**
 * 会话记忆容器。
 *
 * 核心职责：
 * - 按顺序保存用户、助手、工具消息。
 * - 为 `Agent.run()` 提供完整上下文。
 *
 * 主要调用方：
 * - `Agent` 类是这个类的直接使用者。
 *
 * 被哪些方法调用：
 * - `Agent.run()` 调用 `add()` / `addMany()` / `all()`。
 * - `Agent.history()` 调用 `all()`。
 * - `Agent.reset()` 调用 `clear()`。
 */
export class ConversationMemory {
  /** 内部真实消息数组。外部不直接暴露该引用，避免被无意修改。 */
  private readonly messages: AgentMessage[] = [];

  /**
   * 可选地用一组初始消息初始化记忆。
   *
   * 调用方：
   * - 当前仓库里主要由 `Agent` 构造阶段隐式创建空实例。
   * - 如果未来要做持久化恢复，也可以从历史记录构造。
   */
  constructor(initialMessages: AgentMessage[] = []) {
    this.messages.push(...initialMessages);
  }

  /**
   * 追加一条消息。
   *
   * 调用方：
   * - `Agent.run()` 用它追加 user / assistant 消息。
   */
  add(message: AgentMessage): void {
    this.messages.push(message);
  }

  /**
   * 批量追加多条消息。
   *
   * 调用方：
   * - `Agent.run()` 在一轮工具调用结束后，批量加入 tool messages。
   */
  addMany(messages: AgentMessage[]): void {
    this.messages.push(...messages);
  }

  /**
   * 用一组完整历史替换当前记忆。
   *
   * 调用方：
   * - 历史会话切换后恢复 Agent 上下文。
   */
  replace(messages: AgentMessage[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /**
   * 返回当前所有消息的浅拷贝。
   *
   * 设计目的：
   * - 避免外部直接拿到内部数组引用后进行原地修改。
   *
   * 调用方：
   * - `Agent.run()` 在请求模型前读取完整上下文。
   * - `Agent.run()` 在最终返回结果时也会把完整消息返回给界面层。
   * - `Agent.history()` 直接透传这个结果。
   */
  all(): AgentMessage[] {
    return [...this.messages];
  }

  /**
   * 清空会话。
   *
   * 调用方：
   * - `Agent.reset()`。
   */
  clear(): void {
    this.messages.length = 0;
  }
}
