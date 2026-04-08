# TS Agent

一个纯 TypeScript、无第三方 AI SDK 依赖的最小 Agent 框架。它只依赖 Node 原生 `fetch` 与标准 TypeScript 工具链，适合作为你自己扩展多工具、记忆、规划、RAG 或多 Agent 的起点。

## 特性

- 纯 TS 实现，AI 调用走原生 HTTP，不依赖 OpenAI/LangChain 等 SDK
- 可扩展的 `ChatModel` 抽象，当前内置：
  - `OpenAICompatibleChatModel`: 对接 OpenAI 兼容接口
  - `MockModel`: 本地调试与单元测试
- 通用 `Agent` 循环：模型输出工具调用，框架执行工具，再把结果喂回模型
- 独立 `ToolRegistry`，便于注册业务工具
- 简单 `ConversationMemory`，后续可以替换成持久化记忆

## 快速开始

```bash
npm install
npm run build
```

运行 demo：

```bash
npm run dev
```

默认 demo 会从当前目录 `.env` 读取真实模型配置。

## 环境变量

在 `ts-agent/.env` 中写入：

```bash
OPENAI_MODEL=deepseek-chat
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com/v1
```

## 使用真实模型

```ts
import { Agent, ConversationMemory, OpenAICompatibleChatModel, ToolRegistry } from "./src/index.js";
```

```ts
const model = new OpenAICompatibleChatModel({
  apiKey: process.env.OPENAI_API_KEY!,
  model: process.env.OPENAI_MODEL!,
  baseURL: process.env.OPENAI_BASE_URL!
});
```

你也可以接任何 OpenAI 兼容网关，只要支持 `POST /chat/completions` 和 `tools` 字段。

## 目录结构

```text
src/
  agent.ts        Agent 主循环
  memory.ts       会话记忆
  model.ts        模型抽象与 OpenAI 兼容实现
  tools.ts        工具协议、注册表与示例工具
  types.ts        共享类型定义
  demo.ts         可运行示例
  index.ts        导出入口
```

## 扩展建议

- 增加 `Planner` 层，把长任务拆成子目标
- 增加持久化 memory，支持 SQLite / 文件存储
- 增加 `ToolMiddleware` 做权限、日志、重试
- 增加 streaming 支持
- 增加结构化输出校验
