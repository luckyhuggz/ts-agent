const CONFIG_KEY = "ts-agent-model-config";

export interface ModelConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export const DEFAULT_CONFIG: ModelConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt: "你是一个中文智能体助手。Use tools when they help solve the task. When a tool result is enough, answer directly and concisely.",
};

export function loadConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) as Partial<ModelConfig> };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: ModelConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
