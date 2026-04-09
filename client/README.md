# TS Agent Desktop

基于 **Electron + React + TypeScript + Vite + shadcn/ui + Tailwind CSS** 构建的桌面端 AI Agent 客户端，复用 `../src/` 中的 ts-agent 核心逻辑。

## 功能

- 多轮对话（完整上下文保持）
- 工具调用展示（时间查询、计算器）
- 模型配置（Base URL / API Key / 模型名 / 系统提示词），持久化到 localStorage
- 支持任何 OpenAI 兼容 API（OpenAI、DeepSeek、本地 Ollama 等）
- 桌面原生 HTTP（绕过 CORS，通过 Electron 主进程代理请求）

## 环境要求

### 前端
- Node.js >= 20
- npm / pnpm / yarn

### Electron 桌面端
- 不再依赖 Rust / Tauri CLI
- Windows 打包时建议安装常见桌面打包依赖环境；开发运行仅需 Node.js

## 开发启动

### 仅前端预览

```bash
cd client
npm install
npm run dev:renderer
# 访问 http://localhost:1420
```

> 注意：浏览器模式下仍使用浏览器原生 `fetch`，需要 API 服务端支持 CORS。

### 完整桌面端

```bash
cd client
npm install
npm run dev
# 启动 Vite 渲染进程 + Electron 主进程
```

## 生产构建

```bash
npm run dist
# 产物在 release/
```

## 配置说明

启动后点击右上角 **⚙ 齿轮图标** 打开配置面板：

| 字段 | 说明 | 示例 |
|------|------|------|
| Base URL | API 端点 | `https://api.openai.com/v1` |
| API Key | 鉴权密钥 | `sk-...` |
| 模型名称 | 模型 ID | `gpt-4o-mini` / `deepseek-chat` |
| 系统提示词 | Agent 行为约束 | 可选，留空使用默认 |

配置保存后自动重置对话历史并重建 Agent 实例。

## 项目结构

```
client/
├── electron/
│   ├── main.mts         # Electron 主进程
│   └── preload.cts      # 预加载桥接（IPC -> renderer）
├── src/
│   ├── agent/           # Agent 核心逻辑（适配自 ../src/）
│   │   ├── agent.ts     # Agent 主循环
│   │   ├── memory.ts    # 对话记忆
│   │   ├── model.ts     # OpenAI 兼容模型（通过桌面桥接发起请求）
│   │   ├── tools.ts     # 工具注册表 + 内置工具
│   │   └── types.ts     # 类型定义
│   ├── components/
│   │   ├── ui/          # shadcn/ui 基础组件
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   └── ModelConfig.tsx
│   ├── lib/
│   │   ├── desktop.ts   # Electron / 浏览器运行时适配
│   │   ├── config.ts    # 配置持久化（localStorage）
│   │   └── utils.ts     # cn() 工具函数
│   └── App.tsx
```

## 架构说明

- 业务逻辑、UI、配置项、Agent 循环保持不变
- 原本由 Tauri Rust 层提供的 HTTP 能力，已改为 Electron 主进程通过 IPC 代理
- `src-tauri/` 目录不再参与当前桌面端构建链路，如后续不再需要可手动清理
