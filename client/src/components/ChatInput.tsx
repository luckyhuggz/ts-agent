import { useRef, useState, type KeyboardEvent } from "react";
import { FolderOpen, Home, SendHorizonal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  isLoading: boolean;
  disabled?: boolean;
  workspaceDir: string;
  onChooseWorkspace?: () => void;
  onResetWorkspace?: () => void;
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  disabled,
  workspaceDir,
  onChooseWorkspace,
  onResetWorkspace,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">工作目录</span>
        <code className="max-w-full rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {workspaceDir || "加载中..."}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onChooseWorkspace}
          disabled={isLoading}
          className="h-7 gap-1.5 px-2 text-[11px]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          选择文件夹
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onResetWorkspace}
          disabled={isLoading}
          className="h-7 gap-1.5 px-2 text-[11px]"
        >
          <Home className="h-3.5 w-3.5" />
          默认目录
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "请先在设置中配置 API Key…" : "输入消息… (Enter 发送，Shift+Enter 换行)"}
          disabled={disabled || isLoading}
          rows={1}
          className={cn(
            "min-h-[44px] max-h-[200px] flex-1 py-3 text-sm",
            "transition-[height] duration-100"
          )}
          style={{
            height: "auto",
            overflowY: value.split("\n").length > 4 ? "auto" : "hidden",
          }}
          onInput={(e) => {
            const target = e.currentTarget;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
          }}
        />
        {isLoading ? (
          <Button
            size="icon"
            variant="outline"
            onClick={onStop}
            title="停止"
            className="shrink-0"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={submit}
            disabled={!value.trim() || disabled}
            title="发送 (Enter)"
            className="shrink-0"
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground/60">
        AI 可能犯错，请自行核实重要信息
      </p>
    </div>
  );
}
