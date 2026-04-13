import { formatDistanceToNow } from "./date";
import { MessageSquarePlus, Settings, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ModelConfigDialog } from "@/components/ModelConfig";
import { SkillManagerDialog } from "@/components/SkillManagerDialog";
import type { ChatSessionSummary, SkillSummary } from "@/electron.d";
import type { ModelConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

interface SessionSidebarProps {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  skills: SkillSummary[];
  onImportSkill: () => void;
  isImportingSkill?: boolean;
  config: ModelConfig;
  onConfigSave: (config: ModelConfig) => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  skills,
  onImportSkill,
  isImportingSkill,
  config,
  onConfigSave,
}: SessionSidebarProps) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-muted/20">
      <div className="px-4 py-4">
        <div className="text-sm font-semibold">会话</div>
        <div className="mt-1 text-xs text-muted-foreground">当前工作区的历史记录</div>
      </div>

      <Separator />

      <div className="space-y-2 px-4 py-4">
        <Button type="button" className="w-full justify-start gap-2" onClick={onNewSession}>
          <MessageSquarePlus className="h-4 w-4" />
          新建对话
        </Button>

        <SkillManagerDialog
          skills={skills}
          onImportSkill={onImportSkill}
          isImporting={isImportingSkill}
          trigger={
            <Button type="button" variant="outline" className="w-full justify-start gap-2">
              <Sparkles className="h-4 w-4" />
              技能管理
            </Button>
          }
        />

        <ModelConfigDialog
          config={config}
          onSave={onConfigSave}
          trigger={
            <Button type="button" variant="outline" className="w-full justify-start gap-2">
              <Settings className="h-4 w-4" />
              模型配置
            </Button>
          }
        />
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          历史会话
        </div>

        <div className="space-y-1.5">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={cn(
                "w-full rounded-2xl border px-3 py-3 text-left transition-colors",
                session.id === activeSessionId
                  ? "border-primary/30 bg-background shadow-sm"
                  : "border-transparent hover:border-border/70 hover:bg-background/70",
              )}
            >
              <div className="truncate text-sm font-medium">{session.title}</div>
              <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
                {session.preview || "暂无消息"}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{formatDistanceToNow(session.lastMessageAt)}</span>
                <span>{session.messageCount} 条</span>
              </div>
            </button>
          ))}

          {sessions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
              当前工作区还没有历史会话
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
