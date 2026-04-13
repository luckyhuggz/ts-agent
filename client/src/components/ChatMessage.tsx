import { useMemo, useState } from "react";
import { BriefcaseBusiness, Check, ChevronDown, ChevronRight, Copy, Sparkles, User, Wrench } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentMessage, ToolCall } from "@/agent/types";

type ActivityKind = "tool" | "skill" | "agent";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolCalls?: ToolCall[];
  toolName?: string;
  isStreaming?: boolean;
  createdAt?: string;
  sortOrder?: number;
}

interface ActivityCardProps {
  name?: string;
  content: string;
  variant: "call" | "result";
}

function ActivityCard({ name, content, variant }: ActivityCardProps) {
  const [expanded, setExpanded] = useState(variant === "call");
  const kind = inferActivityKind(name);
  const Icon = getActivityIcon(kind);
  const kindLabel = getActivityLabel(kind);
  const hasContent = Boolean(content.trim());

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/80 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60"
        onClick={() => hasContent && setExpanded((prev) => !prev)}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">
            {kindLabel} · {name ?? "unknown"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {variant === "call" ? "调用参数" : "执行结果"}
          </div>
        </div>
        {hasContent && (
          expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {hasContent ? (
        expanded && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-b border-border/60 px-3 py-3 text-xs leading-6 text-muted-foreground select-text">
            {content}
          </pre>
        )
      ) : (
        <div className="border-b border-border/60 px-3 py-3 text-xs text-muted-foreground">无附加内容</div>
      )}

      {/* <div className="flex justify-end px-3 py-2">
        <MessageCopyButton text={content || `${kindLabel} · ${name ?? "unknown"}`} />
      </div> */}
    </div>
  );
}

function MessageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : "复制"}
    </Button>
  );
}

function AssistantMarkdown({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <Streamdown
      className="message-markdown"
      mode={isStreaming ? "streaming" : "static"}
      isAnimating={Boolean(isStreaming)}
      parseIncompleteMarkdown
      lineNumbers={false}
      controls={{
        code: { copy: true, download: false },
        table: { copy: true, download: false, fullscreen: false },
        mermaid: false,
      }}
    >
      {content}
    </Streamdown>
  );
}

interface ChatMessageProps {
  message: DisplayMessage;
}

function AssistantLoadingIndicator({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="assistant-loading-inline" aria-hidden="true">
        <span className="assistant-loading-inline-dot" />
        <span className="assistant-loading-inline-dot" />
        <span className="assistant-loading-inline-dot" />
      </span>
    );
  }

  return (
    <div className="assistant-loading-card" aria-live="polite" aria-label="Assistant is generating a response">
      <div className="assistant-loading-orb" />
      <div className="assistant-loading-copy">
        <span className="assistant-loading-title">正在思考</span>
        <span className="assistant-loading-subtitle">生成回复中</span>
      </div>
      <span className="assistant-loading-inline" aria-hidden="true">
        <span className="assistant-loading-inline-dot" />
        <span className="assistant-loading-inline-dot" />
        <span className="assistant-loading-inline-dot" />
      </span>
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const isAssistant = message.role === "assistant";
  const hasBubbleContent = isUser || isError || Boolean(message.content) || Boolean(message.isStreaming);
  const hasAssistantText = Boolean(message.content.trim());

  const copyText = useMemo(() => {
    if (message.content) {
      return message.content;
    }
    if (message.toolCalls?.length) {
      return JSON.stringify(message.toolCalls, null, 2);
    }
    return "";
  }, [message.content, message.toolCalls]);

  if (message.role === "tool") {
    return (
      <div className="px-4 py-2">
        <div className="max-w-3xl">
          <ActivityCard
            name={message.toolName}
            content={formatToolMessageContent(message.content)}
            variant="result"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}

      <div className={cn("flex max-w-[78%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        {hasBubbleContent && (
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : isError
                  ? "rounded-tl-sm border border-destructive/20 bg-destructive/10 text-destructive"
                  : "rounded-tl-sm bg-secondary text-secondary-foreground",
            )}
          >
            {isUser || isError ? (
              <div className="whitespace-pre-wrap break-words select-text">{message.content || "…"}</div>
            ) : (
              <div className="select-text">
                {hasAssistantText ? (
                  <>
                    <AssistantMarkdown content={message.content} isStreaming={message.isStreaming} />
                    {message.isStreaming && <AssistantLoadingIndicator compact />}
                  </>
                ) : message.isStreaming ? (
                  <AssistantLoadingIndicator />
                ) : (
                  <AssistantMarkdown content={message.content} isStreaming={message.isStreaming} />
                )}
              </div>
            )}
          </div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full space-y-2">
            {message.toolCalls.map((toolCall) => (
              <ActivityCard
                key={toolCall.id}
                name={toolCall.name}
                content={formatToolCallArguments(toolCall)}
                variant="call"
              />
            ))}
          </div>
        )}

        {!isAssistant && (
          <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
            <MessageCopyButton text={copyText} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 将 Agent 返回的完整 AgentMessage[] 转换为前端展示用的 DisplayMessage[] */
export function agentMessagesToDisplay(messages: AgentMessage[]): DisplayMessage[] {
  return messages.map((msg, index) => {
    if (msg.role === "tool") {
      return {
        id: msg.id ?? String(index),
        role: "tool",
        content: msg.content,
        toolName: msg.name,
        sortOrder: index,
      };
    }
    return {
      id: msg.id ?? String(index),
      role: msg.role === "system" ? "assistant" : msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls,
      sortOrder: index,
    };
  });
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatToolCallArguments(toolCall: ToolCall): string {
  if (!toolCall.argumentsParseError) {
    return formatJson(toolCall.arguments);
  }

  return JSON.stringify(
    {
      parseError: toolCall.argumentsParseError,
      rawArgumentsPreview: toolCall.rawArguments?.slice(0, 4000) ?? "",
    },
    null,
    2,
  );
}

function formatToolMessageContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

function inferActivityKind(name?: string): ActivityKind {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized.includes("skill")) {
    return "skill";
  }
  if (normalized.includes("agent")) {
    return "agent";
  }
  return "tool";
}

function getActivityLabel(kind: ActivityKind): string {
  switch (kind) {
    case "skill":
      return "Skill";
    case "agent":
      return "Agent";
    default:
      return "Tool";
  }
}

function getActivityIcon(kind: ActivityKind) {
  switch (kind) {
    case "skill":
      return Sparkles;
    case "agent":
      return BriefcaseBusiness;
    default:
      return Wrench;
  }
}
