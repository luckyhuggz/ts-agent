const CONFIG_KEY = "ts-agent-model-config";

export interface ModelConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  workspaceDir: string;
}

export const DEFAULT_CONFIG: ModelConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  maxTokens: 8000,
  systemPrompt: "你是一个中文智能体助手。Use tools when they help solve the task. When a tool result is enough, answer directly and concisely.",
  workspaceDir: "",
};

function normalizeStoredMaxTokens(model: string, value: unknown): number {
  const parsedValue =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_CONFIG.maxTokens;
  const clamped = Math.max(1024, parsedValue);

  if (model.trim().toLowerCase() === "deepseek-chat") {
    return Math.min(clamped, 8192);
  }

  return clamped;
}

export function loadConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ModelConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      maxTokens: normalizeStoredMaxTokens(parsed.model ?? DEFAULT_CONFIG.model, parsed.maxTokens),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: ModelConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
