import { contextBridge, ipcRenderer } from "electron";

interface DesktopHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface DesktopHttpStreamRequest extends DesktopHttpRequest {
  streamId: string;
}

interface DesktopHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

interface DesktopDocumentReadRequest {
  filePath: string;
}

interface DesktopDocumentReadResponse {
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
  truncated: boolean;
  charCount: number;
  warnings: string[];
}

interface DesktopDocumentWriteRequest {
  filePath: string;
  content?: string;
  appendContent?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
}

interface DesktopDocumentWriteResponse {
  filePath: string;
  fileName: string;
  extension: string;
  charCount: number;
  mode: "overwrite" | "replace_text";
  replacedCount: number;
}

interface DesktopDocumentPatchRequest {
  patch: string;
}

interface DesktopDocumentPatchFileResponse {
  filePath: string;
  fileName: string;
  extension: string;
  action: "add" | "update";
  charCount: number;
}

interface DesktopDocumentPatchResponse {
  applied: number;
  files: DesktopDocumentPatchFileResponse[];
}

interface DesktopShellCommandRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface DesktopShellCommandResponse {
  command: string;
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  timedOut: boolean;
  success: boolean;
}

interface WorkspaceInfo {
  defaultWorkspaceDir: string;
  currentWorkspaceDir: string;
  skillsDir: string;
}

interface SkillSummary {
  name: string;
  description: string;
  skillDir: string;
  skillFilePath: string;
  version?: string;
  whenToUse?: string;
  tags: string[];
}

interface LoadedSkill extends SkillSummary {
  content: string;
  resources: string[];
}

interface ImportSkillRequest {
  sourcePath: string;
  replaceExisting?: boolean;
}

interface ImportSkillResponse {
  imported: boolean;
  skill: SkillSummary;
  targetDir: string;
}

interface SkillResourceResponse {
  skillName: string;
  relativePath: string;
  absolutePath: string;
  content: string;
}

interface PersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolCalls?: PersistedToolCall[];
  createdAt: string;
  sortOrder: number;
}

interface ChatSessionSummary {
  id: string;
  workspaceDir: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

interface CreateChatSessionRequest {
  workspaceDir: string;
  title?: string;
}

interface SaveChatSessionMessagesRequest {
  sessionId: string;
  workspaceDir: string;
  messages: ChatHistoryMessage[];
}

contextBridge.exposeInMainWorld("desktop", {
  httpRequest(request: DesktopHttpRequest): Promise<DesktopHttpResponse> {
    return ipcRenderer.invoke("desktop:http-request", request);
  },
  httpRequestStream(
    request: DesktopHttpStreamRequest,
    onChunk: (chunk: string) => void,
  ): Promise<DesktopHttpResponse> {
    const chunkChannel = `desktop:http-stream:${request.streamId}:chunk`;
    const endChannel = `desktop:http-stream:${request.streamId}:end`;
    const errorChannel = `desktop:http-stream:${request.streamId}:error`;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        ipcRenderer.removeAllListeners(chunkChannel);
        ipcRenderer.removeAllListeners(endChannel);
        ipcRenderer.removeAllListeners(errorChannel);
      };

      ipcRenderer.on(chunkChannel, (_event, chunk: string) => {
        onChunk(chunk);
      });

      ipcRenderer.once(endChannel, (_event, response: DesktopHttpResponse) => {
        cleanup();
        resolve(response);
      });

      ipcRenderer.once(
        errorChannel,
        (
          _event,
          error: {
            name?: string;
            message?: string;
          },
        ) => {
          cleanup();
          const nextError = new Error(error.message ?? "Streaming request failed.");
          nextError.name = error.name ?? "Error";
          reject(nextError);
        },
      );

      ipcRenderer.send("desktop:http-stream-start", request);
    });
  },
  abortHttpRequestStream(streamId: string): void {
    ipcRenderer.send("desktop:http-stream-abort", streamId);
  },
  readDocument(request: DesktopDocumentReadRequest): Promise<DesktopDocumentReadResponse> {
    return ipcRenderer.invoke("desktop:read-document", request);
  },
  writeDocument(request: DesktopDocumentWriteRequest): Promise<DesktopDocumentWriteResponse> {
    return ipcRenderer.invoke("desktop:write-document", request);
  },
  applyDocumentPatch(request: DesktopDocumentPatchRequest): Promise<DesktopDocumentPatchResponse> {
    return ipcRenderer.invoke("desktop:apply-document-patch", request);
  },
  runShellCommand(request: DesktopShellCommandRequest): Promise<DesktopShellCommandResponse> {
    return ipcRenderer.invoke("desktop:run-shell-command", request);
  },
  getWorkspaceInfo(): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke("desktop:get-workspace-info");
  },
  setWorkspace(workspaceDir: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke("desktop:set-workspace", workspaceDir);
  },
  chooseWorkspace(): Promise<WorkspaceInfo | null> {
    return ipcRenderer.invoke("desktop:choose-workspace");
  },
  listSkills(): Promise<SkillSummary[]> {
    return ipcRenderer.invoke("desktop:list-skills");
  },
  loadSkill(skillName: string): Promise<LoadedSkill> {
    return ipcRenderer.invoke("desktop:load-skill", skillName);
  },
  readSkillResource(request: { skillName: string; relativePath: string }): Promise<SkillResourceResponse> {
    return ipcRenderer.invoke("desktop:read-skill-resource", request);
  },
  importSkill(request: ImportSkillRequest): Promise<ImportSkillResponse> {
    return ipcRenderer.invoke("desktop:import-skill", request);
  },
  chooseSkillImportSource(): Promise<string | null> {
    return ipcRenderer.invoke("desktop:choose-skill-import-source");
  },
  listChatSessions(workspaceDir: string): Promise<ChatSessionSummary[]> {
    return ipcRenderer.invoke("desktop:list-chat-sessions", workspaceDir);
  },
  getChatSessionMessages(sessionId: string): Promise<ChatHistoryMessage[]> {
    return ipcRenderer.invoke("desktop:get-chat-session-messages", sessionId);
  },
  createChatSession(request: CreateChatSessionRequest): Promise<ChatSessionSummary> {
    return ipcRenderer.invoke("desktop:create-chat-session", request);
  },
  saveChatSessionMessages(request: SaveChatSessionMessagesRequest): Promise<ChatSessionSummary> {
    return ipcRenderer.invoke("desktop:save-chat-session-messages", request);
  },
});
