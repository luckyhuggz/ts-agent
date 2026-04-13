import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ModelConfig } from "@/lib/config";

interface ModelConfigDialogProps {
  config: ModelConfig;
  onSave: (config: ModelConfig) => void;
  trigger?: ReactNode;
}

export function ModelConfigDialog({ config, onSave, trigger }: ModelConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModelConfig>(config);

  function handleOpen(isOpen: boolean) {
    if (isOpen) setDraft(config);
    setOpen(isOpen);
  }

  function handleSave() {
    onSave(draft);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" title="模型配置">
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="baseURL">Base URL</Label>
            <Input
              id="baseURL"
              placeholder="https://api.openai.com/v1"
              value={draft.baseURL}
              onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-..."
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="model">模型名称</Label>
            <Input
              id="model"
              placeholder="gpt-4o-mini"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="maxTokens">最大输出 Tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              min={1024}
              step={512}
              value={String(draft.maxTokens)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  maxTokens: Math.max(1024, Number.parseInt(e.target.value || "0", 10) || 1024),
                })
              }
            />
          </div>

          <Separator />

          <div className="grid gap-1.5">
            <Label htmlFor="systemPrompt">系统提示词</Label>
            <Textarea
              id="systemPrompt"
              placeholder="你是一个智能助手..."
              value={draft.systemPrompt}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!draft.apiKey.trim() || !draft.model.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
