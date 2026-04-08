import { Agent } from "./agent.js";
import { getRequiredEnv } from "./env.js";
import { ConversationMemory } from "./memory.js";
import { OpenAICompatibleChatModel } from "./model.js";
import { createCalculatorTool, createClockTool, ToolRegistry } from "./tools.js";

/** 加载环境、注册示例工具并跑一次 `Agent.run`，用于端到端验证。 */
async function main(): Promise<void> {
  const env = getRequiredEnv();

  const tools = new ToolRegistry()
    .register(createClockTool())
    .register(createCalculatorTool());

  const agent = new Agent({
    model: new OpenAICompatibleChatModel({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseURL: env.OPENAI_BASE_URL
    }),
    tools,
    memory: new ConversationMemory(),
    defaultSystemPrompt: [
      "你是一个中文智能体助手",
      "Use tools when they help solve the task.",
      "When a tool result is enough, answer directly and concisely."
    ].join(" ")
  });

  // 这条问题可以触发时间工具，便于验证真实模型的 tool calling。
  const result = await agent.run("你是谁？详细介绍");
  console.log("Agent output:\n");
  console.log(result.output);
  console.log("\nSteps:", result.steps);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
