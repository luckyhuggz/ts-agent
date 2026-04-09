import { Bot, User, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentMessage, ToolCall } from "@/agent/types";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolCalls?: ToolCall[];
  toolName?: string;
  isStreaming?: boolean;
}

interface ToolCallCardProps {
  toolCall: ToolCall;
}

function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasArgs = Object.keys(toolCall.arguments).length > 0;

  return (
    <div className="mt-1.5 rounded-md border border-border/60 bg-muted/40 text-xs overflow-hidden">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{toolCall.name}</span>
        {hasArgs && (
          expanded
            ? <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {expanded && hasArgs && (
        <pre className="border-t border-border/40 px-3 py-2 text-muted-foreground overflow-x-auto">
          {JSON.stringify(toolCall.arguments, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface ToolResultCardProps {
  content: string;
  toolName?: string;
}

function ToolResultCard({ content, toolName }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 text-xs overflow-hidden">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3 w-3 shrink-0 text-green-500" />
        <span className="font-mono font-medium text-muted-foreground">
          {toolName ?? "tool"} 返回
        </span>
        {expanded
          ? <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
          : <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        }
      </button>
      {expanded && (
        <pre className="border-t border-border/40 px-3 py-2 text-muted-foreground overflow-x-auto">
          {typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface ChatMessageProps {
  message: DisplayMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isError = message.role === "error";

  if (message.role === "tool") {
    return (
      <div className="px-4 py-1">
        <ToolResultCard content={message.content} toolName={message.toolName} />
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isUser
            ? "bg-primary text-primary-foreground"
            : isError
            ? "bg-destructive text-destructive-foreground"
            : "bg-secondary text-secondary-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div className={cn("flex max-w-[75%] flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : isError
              ? "rounded-tl-sm bg-destructive/10 text-destructive border border-destructive/20"
              : "rounded-tl-sm bg-secondary text-secondary-foreground"
          )}
        >
          {message.content || (message.isStreaming ? "" : "…")}
          {message.isStreaming && (
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-current opacity-70" />
          )}
        </div>

        {/* Tool calls (assistant invoked tools) */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 将 Agent 返回的完整 AgentMessage[] 转换为前端展示用的 DisplayMessage[] */
export function agentMessagesToDisplay(messages: AgentMessage[]): DisplayMessage[] {
  return messages.map((msg, i) => {
    if (msg.role === "tool") {
      return {
        id: String(i),
        role: "tool",
        content: msg.content,
        toolName: msg.name,
      };
    }
    return {
      id: String(i),
      role: msg.role === "system" ? "assistant" : msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls,
    };
  });
}
