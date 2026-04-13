import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage, type DisplayMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { SessionSidebar } from "@/components/SessionSidebar";
import { loadConfig, saveConfig, type ModelConfig } from "@/lib/config";
import {
  chooseSkillImportSource,
  chooseWorkspace,
  createChatSession,
  getChatSessionMessages,
  getWorkspaceInfo,
  importSkill,
  listChatSessions,
  listSkills,
  saveChatSessionMessages,
  setWorkspace,
} from "@/lib/desktop";
import type {
  ChatHistoryMessage,
  ChatSessionSummary,
  SkillSummary,
  WorkspaceInfo,
} from "@/electron.d";
import { Agent } from "@/agent/agent";
import { OpenAICompatibleChatModel } from "@/agent/model";
import type { AgentMessage, AgentRunEvent } from "@/agent/types";
import {
  ToolRegistry,
  createCalculatorTool,
  createClockTool,
  createDocumentEditTool,
  createDocumentPatchTool,
  createDocumentReadTool,
  createDocumentWriteTool,
  createImportSkillTool,
  createListSkillsTool,
  createLoadSkillTool,
  createReadSkillResourceTool,
  createShellTool,
} from "@/agent/tools";

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
    .register(createDocumentWriteTool())
    .register(createDocumentEditTool())
    .register(createDocumentPatchTool())
    .register(createShellTool())
    .register(createListSkillsTool())
    .register(createLoadSkillTool())
    .register(createReadSkillResourceTool())
    .register(createImportSkillTool());

  return new Agent({
    model,
    tools,
    defaultSystemPrompt: config.systemPrompt || undefined,
  });
}

export default function App() {
  const [config, setConfig] = useState<ModelConfig>(loadConfig);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const agentRef = useRef<Agent | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<DisplayMessage[]>([]);
  const skipPersistRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (config.apiKey && config.model) {
      const nextAgent = buildAgent(config);
      nextAgent.loadHistory(displayMessagesToAgentMessages(messagesRef.current));
      agentRef.current = nextAgent;
    } else {
      agentRef.current = null;
    }
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    async function initializeWorkspace() {
      try {
        const info = await getWorkspaceInfo();
        const desiredWorkspace = config.workspaceDir.trim() || info.defaultWorkspaceDir;
        const nextInfo =
          desiredWorkspace === info.currentWorkspaceDir ? info : await setWorkspace(desiredWorkspace);

        if (cancelled) return;
        setWorkspaceInfo(nextInfo);

        if (config.workspaceDir !== nextInfo.currentWorkspaceDir) {
          const nextConfig = { ...config, workspaceDir: nextInfo.currentWorkspaceDir };
          saveConfig(nextConfig);
          setConfig(nextConfig);
        }
      } catch (err) {
        if (cancelled) return;
        setError(toErrorText(err));
      }
    }

    void initializeWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  const hydrateSession = useCallback(async (sessionId: string, cancelled?: () => boolean) => {
    const history = await getChatSessionMessages(sessionId);
    if (cancelled?.()) return;

    const nextMessages = history.map(historyMessageToDisplayMessage);
    skipPersistRef.current = true;
    setActiveSessionId(sessionId);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    agentRef.current?.loadHistory(historyMessagesToAgentMessages(history));
    setShouldAutoScroll(true);
  }, []);

  useEffect(() => {
    if (!workspaceInfo?.currentWorkspaceDir) return;
    const workspaceDir = workspaceInfo.currentWorkspaceDir;

    let cancelled = false;

    async function loadWorkspaceContext() {
      try {
        const [nextSkills, nextSessions] = await Promise.all([
          listSkills().catch(() => [] as SkillSummary[]),
          listChatSessions(workspaceDir),
        ]);

        if (cancelled) return;
        setSkills(nextSkills);
        setSessions(nextSessions);

        if (nextSessions.length === 0) {
          const created = await createChatSession({ workspaceDir });
          if (cancelled) return;

          setSessions([created]);
          skipPersistRef.current = true;
          setActiveSessionId(created.id);
          messagesRef.current = [];
          setMessages([]);
          agentRef.current?.reset();
          setShouldAutoScroll(true);
          return;
        }

        const nextActiveSessionId =
          activeSessionIdRef.current &&
          nextSessions.some((session) => session.id === activeSessionIdRef.current)
            ? activeSessionIdRef.current
            : nextSessions[0].id;

        abortControllerRef.current?.abort();
        setIsLoading(false);
        await hydrateSession(nextActiveSessionId, () => cancelled);
      } catch (err) {
        if (cancelled) return;
        setError(toErrorText(err));
      }
    }

    void loadWorkspaceContext();
    return () => {
      cancelled = true;
    };
  }, [hydrateSession, workspaceInfo?.currentWorkspaceDir]);

  useEffect(() => {
    if (!activeSessionId || !workspaceInfo?.currentWorkspaceDir) {
      return;
    }

    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const summary = await saveChatSessionMessages({
          sessionId: activeSessionId,
          workspaceDir: workspaceInfo.currentWorkspaceDir,
          messages: serializeDisplayMessages(messagesRef.current),
        });

        setSessions((prev) => upsertAndSortSessions(prev, summary));
      } catch (err) {
        setError(toErrorText(err));
      }
    }, isLoading ? 1200 : 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeSessionId, isLoading, messages, workspaceInfo?.currentWorkspaceDir]);

  useEffect(() => {
    const viewport = getScrollViewport(scrollAreaRef.current);
    if (!viewport) return;

    const handlePointerDown = () => {
      if (isLoading) {
        setShouldAutoScroll(false);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isLoading) return;
      if (event.deltaY < 0 || !isNearBottom(viewport)) {
        setShouldAutoScroll(false);
      }
    };

    const handleScroll = () => {
      if (isNearBottom(viewport)) {
        setShouldAutoScroll(true);
      }
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [isLoading]);

  useEffect(() => {
    if (!shouldAutoScroll) return;
    const viewport = getScrollViewport(scrollAreaRef.current);
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: isLoading ? "auto" : "smooth",
    });
  }, [isLoading, messages, shouldAutoScroll]);

  const handleConfigSave = useCallback(
    (nextConfig: ModelConfig) => {
      saveConfig(nextConfig);
      setConfig(nextConfig);
      setError(null);
    },
    [],
  );

  const applyWorkspace = useCallback((nextInfo: WorkspaceInfo) => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    setWorkspaceInfo(nextInfo);
    setSessions([]);
    setSkills([]);
    setActiveSessionId(null);
    messagesRef.current = [];
    setMessages([]);
    setShouldAutoScroll(true);
    setConfig((prev) => {
      const nextConfig = { ...prev, workspaceDir: nextInfo.currentWorkspaceDir };
      saveConfig(nextConfig);
      return nextConfig;
    });
  }, []);

  const handleChooseWorkspace = useCallback(async () => {
    try {
      const nextInfo = await chooseWorkspace();
      if (!nextInfo) return;
      applyWorkspace(nextInfo);
    } catch (err) {
      setError(toErrorText(err));
    }
  }, [applyWorkspace]);

  const handleResetWorkspace = useCallback(async () => {
    try {
      const info = await getWorkspaceInfo();
      const nextInfo = await setWorkspace(info.defaultWorkspaceDir);
      applyWorkspace(nextInfo);
    } catch (err) {
      setError(toErrorText(err));
    }
  }, [applyWorkspace]);

  const handleCreateSession = useCallback(async () => {
    if (!workspaceInfo?.currentWorkspaceDir) return;

    try {
      abortControllerRef.current?.abort();
      setIsLoading(false);

      const created = await createChatSession({ workspaceDir: workspaceInfo.currentWorkspaceDir });
      setSessions((prev) => upsertAndSortSessions(prev, created));
      skipPersistRef.current = true;
      setActiveSessionId(created.id);
      messagesRef.current = [];
      setMessages([]);
      agentRef.current?.reset();
      setError(null);
      setShouldAutoScroll(true);
    } catch (err) {
      setError(toErrorText(err));
    }
  }, [workspaceInfo?.currentWorkspaceDir]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) return;

      try {
        abortControllerRef.current?.abort();
        setIsLoading(false);
        setError(null);
        await hydrateSession(sessionId);
      } catch (err) {
        setError(toErrorText(err));
      }
    },
    [activeSessionId, hydrateSession],
  );

  const handleImportSkill = useCallback(async () => {
    try {
      setIsImportingSkill(true);
      const sourcePath = await chooseSkillImportSource();
      if (!sourcePath) return;

      await importSkill({ sourcePath });
      const nextSkills = await listSkills();
      setSkills(nextSkills);
      setError(null);
    } catch (err) {
      setError(toErrorText(err));
    } finally {
      setIsImportingSkill(false);
    }
  }, []);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (!agentRef.current || isLoading || !workspaceInfo?.currentWorkspaceDir) return;

      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await createChatSession({ workspaceDir: workspaceInfo.currentWorkspaceDir });
        setSessions((prev) => upsertAndSortSessions(prev, created));
        setActiveSessionId(created.id);
        messagesRef.current = [];
        agentRef.current.reset();
        sessionId = created.id;
      }

      const now = new Date().toISOString();
      const userMsg: DisplayMessage = {
        id: createDisplayMessageId("user"),
        role: "user",
        content: text,
        createdAt: now,
        sortOrder: messagesRef.current.length,
      };

      setError(null);
      setShouldAutoScroll(true);
      setMessages((prev) => {
        const next = [...prev, userMsg];
        messagesRef.current = next;
        return next;
      });
      setIsLoading(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const runtimePrompt = buildRuntimeSystemPrompt(
          config.systemPrompt,
          workspaceInfo.currentWorkspaceDir,
          skills,
        );

        await agentRef.current.run(text, {
          systemPrompt: runtimePrompt,
          signal: controller.signal,
          maxSteps: 20,
          maxTokens: config.maxTokens,
          onEvent: (event) => {
            setMessages((prev) => {
              const next = applyRunEvent(prev, event);
              messagesRef.current = next;
              return next;
            });
          },
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => {
            const next = cleanupStreamingMessages(prev);
            messagesRef.current = next;
            return next;
          });
        } else {
          const errorText = toErrorText(err);
          setError(errorText);
          setMessages((prev) => {
            const next = cleanupStreamingMessages(prev);
            messagesRef.current = next;
            return next;
          });
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        void refreshWorkspaceState(setWorkspaceInfo, setError);
        void listSkills()
          .then((nextSkills) => setSkills(nextSkills))
          .catch(() => undefined);
      }
    },
    [
      activeSessionId,
      config.maxTokens,
      config.systemPrompt,
      isLoading,
      skills,
      workspaceInfo?.currentWorkspaceDir,
    ],
  );

  const isConfigured = Boolean(config.apiKey.trim() && config.model.trim());
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  return (
    <div className="flex h-screen bg-background">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleCreateSession}
        skills={skills}
        onImportSkill={handleImportSkill}
        isImportingSkill={isImportingSkill}
        config={config}
        onConfigSave={handleConfigSave}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">TS Agent Desktop</span>
              {config.model && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {config.model}
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {activeSession?.title ?? "新对话"}
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden">
          <ScrollArea ref={scrollAreaRef} className="h-full">
            <div className="py-4">
              {messages.length === 0 ? (
                <EmptyState isConfigured={isConfigured} />
              ) : (
                messages.map((message) => <ChatMessage key={message.id} message={message} />)
              )}
            </div>
          </ScrollArea>
        </div>

        {error && (
          <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all">{error}</span>
            <button
              type="button"
              className="ml-auto shrink-0 text-xs underline opacity-70 hover:opacity-100"
              onClick={() => setError(null)}
            >
              关闭
            </button>
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          disabled={!isConfigured}
          workspaceDir={workspaceInfo?.currentWorkspaceDir || config.workspaceDir}
          onChooseWorkspace={handleChooseWorkspace}
          onResetWorkspace={handleResetWorkspace}
        />
      </div>
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
          <p className="text-sm text-muted-foreground">发送消息开始对话</p>
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
        <p className="text-sm text-muted-foreground">请先在左侧配置模型参数后开始对话</p>
      )}
    </div>
  );
}

function buildRuntimeSystemPrompt(basePrompt: string, workspaceDir: string, skills: SkillSummary[]): string {
  const safeBasePrompt = basePrompt.trim();
  const runtimeSections = [
    safeBasePrompt,
    [
      "Workspace Rules:",
      `- The current workspace directory is: ${workspaceDir || "(not set)"}`,
      "- Treat this workspace as the default place for generated files, scripts, copied documents, and other artifacts.",
      "- Relative file paths should be interpreted relative to the workspace.",
    ].join("\n"),
    [
      "File Writing Strategy:",
      "- For small or medium complete files, use write_document_content.",
      "- For targeted small edits to existing .txt/.md/.html files, use read_document_content first and then use edit_document_content with oldString/newString.",
      "- For large edits to existing .txt/.md/.html files, prefer apply_patch_document.",
      "- For very large brand-new file generation, especially long HTML, Markdown, or plain text, prefer lucky-file blocks instead of a huge apply_patch_document JSON payload.",
      "- For .docx files, only use complete content overwrite.",
      "- apply_patch_document supports a patch block with *** Begin Patch / *** End Patch, and operations like *** Add File or *** Update File.",
      "- apply_patch_document is best for existing-file edits or moderate file creation. Do not wrap an extremely large whole-file body in one patch JSON string.",
      "- Do not send a very large whole file body to write_document_content or edit_document_content.",
      "- If apply_patch_document is not practical or the response is at risk of being cut off, fall back to assistant lucky-file blocks using this exact format:",
      '  <lucky-file path="relative/or/absolute/file.html" mode="overwrite">',
      "  ...raw file content here...",
      "  </lucky-file>",
      "- For very large text files, you may continue the same file with mode=\"append\" in later lucky-file blocks.",
      "- lucky-file is the preferred fallback for very large whole-file generation.",
      "- Keep each lucky-file block reasonably sized so the model can finish each block and close it reliably.",
      "- The app will automatically persist lucky-file blocks to disk after generation.",
    ].join("\n"),
    renderSkillsPrompt(skills),
  ].filter(Boolean);

  return runtimeSections.join("\n\n");
}

function renderSkillsPrompt(skills: SkillSummary[]): string {
  if (skills.length === 0) {
    return [
      "Skills:",
      "- No skills are currently installed in this workspace.",
      "- If the user wants to add one, use the import_skill tool to import a skill directory containing SKILL.md.",
    ].join("\n");
  }

  const catalog = skills
    .slice(0, 40)
    .map((skill) => {
      const extra = skill.whenToUse ? ` | when to use: ${skill.whenToUse}` : "";
      return `- ${skill.name}: ${skill.description}${extra}`;
    })
    .join("\n");

  return [
    "Skills:",
    "- The skills below are available in the current workspace.",
    "- If a skill matches the user's task, load it with load_skill before following its instructions.",
    "- If the loaded skill references additional files, read them with read_skill_resource.",
    catalog,
  ].join("\n");
}

async function refreshWorkspaceState(
  setWorkspaceInfoState: (value: WorkspaceInfo | null) => void,
  setErrorState: (value: string | null) => void,
): Promise<void> {
  try {
    const info = await getWorkspaceInfo();
    setWorkspaceInfoState(info);
  } catch (err) {
    setErrorState(toErrorText(err));
  }
}

function applyRunEvent(messages: DisplayMessage[], event: AgentRunEvent): DisplayMessage[] {
  switch (event.type) {
    case "assistant_step_start":
      return [
        ...messages,
        {
          id: event.messageId,
          role: "assistant",
          content: "",
          isStreaming: true,
          createdAt: new Date().toISOString(),
          sortOrder: messages.length,
        },
      ];

    case "assistant_text_delta":
      return messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              content: event.content,
            }
          : message,
      );

    case "assistant_message_complete":
      return messages.map((message) =>
        message.id === event.messageId
          ? {
              ...message,
              content: event.message.content,
              toolCalls: event.message.toolCalls,
              isStreaming: false,
            }
          : message,
      );

    case "tool_message":
      return [...messages, agentMessageToDisplayMessage(event.message, messages.length)];

    default:
      return messages;
  }
}

function cleanupStreamingMessages(messages: DisplayMessage[]): DisplayMessage[] {
  return messages.flatMap((message) => {
    if (!message.isStreaming) {
      return [message];
    }

    const nextMessage = { ...message, isStreaming: false };
    const hasContent = Boolean(nextMessage.content.trim()) || Boolean(nextMessage.toolCalls?.length);
    return hasContent ? [nextMessage] : [];
  });
}

function displayMessagesToAgentMessages(messages: DisplayMessage[]): AgentMessage[] {
  return messages.reduce<AgentMessage[]>((acc, message) => {
      if (message.isStreaming || message.role === "error") {
        return acc;
      }

      if (message.role === "tool") {
        acc.push({
          id: message.id,
          role: "tool",
          content: message.content,
          name: message.toolName,
        });
        return acc;
      }

      acc.push({
        id: message.id,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
      });
      return acc;
    }, []);
}

function historyMessagesToAgentMessages(messages: ChatHistoryMessage[]): AgentMessage[] {
  return messages.reduce<AgentMessage[]>((acc, message) => {
      if (message.role === "error") {
        return acc;
      }

      if (message.role === "tool") {
        acc.push({
          id: message.id,
          role: "tool",
          content: message.content,
          name: message.toolName,
        });
        return acc;
      }

      acc.push({
        id: message.id,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
      });
      return acc;
    }, []);
}

function historyMessageToDisplayMessage(message: ChatHistoryMessage): DisplayMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    toolName: message.toolName,
    createdAt: message.createdAt,
    sortOrder: message.sortOrder,
  };
}

function agentMessageToDisplayMessage(message: AgentMessage, sortOrder: number): DisplayMessage {
  if (message.role === "tool") {
    return {
      id: message.id ?? createDisplayMessageId("tool"),
      role: "tool",
      content: message.content,
      toolName: message.name,
      createdAt: new Date().toISOString(),
      sortOrder,
    };
  }

  return {
    id: message.id ?? createDisplayMessageId(message.role),
    role: message.role === "system" ? "assistant" : message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    createdAt: new Date().toISOString(),
    sortOrder,
  };
}

function serializeDisplayMessages(messages: DisplayMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((message) => !message.isStreaming)
    .map((message, index) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      toolName: message.toolName,
      toolCalls: message.toolCalls,
      createdAt: message.createdAt ?? new Date().toISOString(),
      sortOrder: message.sortOrder ?? index,
    }));
}

function upsertAndSortSessions(
  sessions: ChatSessionSummary[],
  nextSession: ChatSessionSummary,
): ChatSessionSummary[] {
  const merged = [nextSession, ...sessions.filter((session) => session.id !== nextSession.id)];
  return merged.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

function createDisplayMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

function isNearBottom(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
