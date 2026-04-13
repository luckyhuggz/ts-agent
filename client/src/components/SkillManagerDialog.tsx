import { useState, type ReactNode } from "react";
import { FolderUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SkillSummary } from "@/electron.d";

interface SkillManagerDialogProps {
  skills: SkillSummary[];
  onImportSkill: () => void;
  isImporting?: boolean;
  trigger?: ReactNode;
}

export function SkillManagerDialog({
  skills,
  onImportSkill,
  isImporting,
  trigger,
}: SkillManagerDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Sparkles className="h-4 w-4" />
            技能管理
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle>技能管理</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">当前工作区可用的 skills</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onImportSkill}
              disabled={isImporting}
            >
              <FolderUp className="h-4 w-4" />
              {isImporting ? "导入中..." : "导入 Skill"}
            </Button>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(80vh-88px)] overflow-y-auto px-6 py-5">
          {skills.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
              当前工作区还没有导入任何 skill
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {skills.map((skill) => (
                <div
                  key={skill.skillFilePath}
                  className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{skill.name}</div>
                      <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                  </div>

                  {skill.whenToUse && (
                    <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      适用场景：{skill.whenToUse}
                    </div>
                  )}

                  {skill.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {skill.tags.slice(0, 6).map((tag) => (
                        <Badge key={`${skill.name}-${tag}`} variant="secondary" className="rounded-full">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
