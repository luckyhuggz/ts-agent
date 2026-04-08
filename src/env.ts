import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AgentEnv {
  OPENAI_MODEL: string;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
}

/** 从指定路径读取 `.env` 并写入 `process.env`；已存在的环境变量不会被覆盖。 */
export function loadEnvFile(filePath = ".env"): void {
  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    return;
  }

  const content = readFileSync(absolutePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1).trim());

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/** 先加载 `.env`，再读取并校验 Agent 运行所需的 `OPENAI_*` 变量。 */
export function getRequiredEnv(): AgentEnv {
  loadEnvFile();

  return {
    OPENAI_MODEL: requireEnv("OPENAI_MODEL"),
    OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
    OPENAI_BASE_URL: requireEnv("OPENAI_BASE_URL")
  };
}

/** 读取环境变量，缺失或为空时抛出明确错误。 */
function requireEnv(name: keyof AgentEnv): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** 去掉 `.env` 值两侧成对的单引号或双引号。 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
