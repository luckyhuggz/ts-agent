import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ChatMessage, type DisplayMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModelConfigDialog } from "@/components/ModelConfig";
import { loadConfig, saveConfig, type ModelConfig } from "@/lib/config";
import { Agent } from "@/agent/agent";
import { OpenAICompatibleChatModel } from "@/agent/model";
import {
  ToolRegistry,
  createClockTool,
  createCalculatorTool,
  createDocumentReadTool,
  createDocumentEditTool,
  createShellTool,
} from "@/agent/tools";

let abortController: AbortController | null = null;

function buildAgent(config: ModelConfig) {
  const model = new OpenAICompatibleChatModel({
    apiKey: config.apiKey,
    model: config.model,
    baseURL: config.baseURL,
  });
  const tools = new ToolRegistry()
    .register(createClockTool())
    .register(createCalculatorTool())
    .register(createDocumentReadTool())
    .register(createDocumentEditTool())
    .register(createShellTool());
  return new Agent({
    model,
    tools,
    defaultSystemPrompt: config.systemPrompt || undefined,
  });
}

export default function App() {
  const [config, setConfig] = useState<ModelConfig>(loadConfig);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentRef = useRef<Agent | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Rebuild agent whenever config changes
  useEffect(() => {
    if (config.apiKey && config.model) {
      agentRef.current = buildAgent(config);
    } else {
      agentRef.current = null;
    }
  }, [config]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleConfigSave(newConfig: ModelConfig) {
    saveConfig(newConfig);
    setConfig(newConfig);
    // Reset conversation when config changes
    agentRef.current?.reset();
    setMessages([]);
    setError(null);
  }

  function handleClear() {
    agentRef.current?.reset();
    setMessages([]);
    setError(null);
  }

  function handleStop() {
    abortController?.abort();
    setIsLoading(false);
  }

  const handleSend = useCallback(
    async (text: string) => {
      if (!agentRef.current) return;
      setError(null);

      // Add user message immediately
      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };
      // Thinking placeholder
      const thinkingMsg: DisplayMessage = {
        id: `thinking-${Date.now()}`,
        role: "assistant",
        content: "",
        isStreaming: true,
      };
      setMessages((prev) => [...prev, userMsg, thinkingMsg]);
      setIsLoading(true);

      abortController = new AbortController();

      try {
        const result = await agentRef.current.run(text);

        // Replace with actual conversation history from the agent
        const allMsgs: DisplayMessage[] = result.messages
          .filter((m) => m.role !== "system")
          .map((m, i) => {
            if (m.role === "tool") {
              return {
                id: `msg-${i}`,
                role: "tool" as const,
                content: m.content,
                toolName: m.name,
              };
            }
            return {
              id: `msg-${i}`,
              role: m.role as "user" | "assistant",
              content: m.content,
              toolCalls: m.toolCalls,
            };
          });

        setMessages(allMsgs);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Stopped by user – remove thinking placeholder
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        } else {
          const errorText = err instanceof Error ? err.message : String(err);
          setError(errorText);
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        }
      } finally {
        setIsLoading(false);
        abortController = null;
      }
    },
    []
  );

  const isConfigured = Boolean(config.apiKey.trim() && config.model.trim());

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">TS Agent Desktop</span>
          {config.model && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground font-mono">
              {config.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={messages.length === 0 || isLoading}
            title="清空对话"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ModelConfigDialog config={config} onSave={handleConfigSave} />
        </div>
      </header>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="py-4">
            {messages.length === 0 ? (
              <EmptyState isConfigured={isConfigured} />
            ) : (
              messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-all">{error}</span>
          <button
            className="ml-auto shrink-0 text-xs underline opacity-70 hover:opacity-100"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isLoading={isLoading}
        disabled={!isConfigured}
      />
    </div>
  );
}

function EmptyState({ isConfigured }: { isConfigured: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Bot className="h-8 w-8 text-primary" />
      </div>
      <h2 className="mb-2 text-lg font-semibold">TS Agent Desktop</h2>
      {isConfigured ? (
        <>
          <p className="text-sm text-muted-foreground">
            发送消息开始对话
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
            {["现在几点了？", "计算 (12 + 8) * 3", "你是谁？"].map((hint) => (
              <span
                key={hint}
                className="rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground"
              >
                {hint}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          请点击右上角 <strong>⚙</strong> 配置模型参数后开始对话
        </p>
      )}
    </div>
  );
}
