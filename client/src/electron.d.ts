export interface DesktopHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DesktopHttpStreamRequest extends DesktopHttpRequest {
  streamId: string;
}

export interface DesktopHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface DesktopDocumentReadRequest {
  filePath: string;
}

export interface DesktopDocumentReadResponse {
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
  truncated: boolean;
  charCount: number;
  warnings: string[];
}

export interface DesktopDocumentWriteRequest {
  filePath: string;
  content?: string;
  appendContent?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
}

export interface DesktopDocumentWriteResponse {
  filePath: string;
  fileName: string;
  extension: string;
  charCount: number;
  mode: "overwrite" | "replace_text";
  replacedCount: number;
}

export interface DesktopShellCommandRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface DesktopShellCommandResponse {
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

export interface WorkspaceInfo {
  defaultWorkspaceDir: string;
  currentWorkspaceDir: string;
  skillsDir: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  skillDir: string;
  skillFilePath: string;
  version?: string;
  whenToUse?: string;
  tags: string[];
}

export interface LoadedSkill extends SkillSummary {
  content: string;
  resources: string[];
}

export interface ImportSkillRequest {
  sourcePath: string;
  replaceExisting?: boolean;
}

export interface ImportSkillResponse {
  imported: boolean;
  skill: SkillSummary;
  targetDir: string;
}

export interface SkillResourceResponse {
  skillName: string;
  relativePath: string;
  absolutePath: string;
  content: string;
}

export interface PersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  content: string;
  toolName?: string;
  toolCalls?: PersistedToolCall[];
  createdAt: string;
  sortOrder: number;
}

export interface ChatSessionSummary {
  id: string;
  workspaceDir: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface CreateChatSessionRequest {
  workspaceDir: string;
  title?: string;
}

export interface SaveChatSessionMessagesRequest {
  sessionId: string;
  workspaceDir: string;
  messages: ChatHistoryMessage[];
}

declare global {
  interface Window {
    desktop?: {
      httpRequest: (request: DesktopHttpRequest) => Promise<DesktopHttpResponse>;
      httpRequestStream: (
        request: DesktopHttpStreamRequest,
        onChunk: (chunk: string) => void,
      ) => Promise<DesktopHttpResponse>;
      abortHttpRequestStream: (streamId: string) => void;
      readDocument: (request: DesktopDocumentReadRequest) => Promise<DesktopDocumentReadResponse>;
      writeDocument: (request: DesktopDocumentWriteRequest) => Promise<DesktopDocumentWriteResponse>;
      runShellCommand: (request: DesktopShellCommandRequest) => Promise<DesktopShellCommandResponse>;
      getWorkspaceInfo: () => Promise<WorkspaceInfo>;
      setWorkspace: (workspaceDir: string) => Promise<WorkspaceInfo>;
      chooseWorkspace: () => Promise<WorkspaceInfo | null>;
      listSkills: () => Promise<SkillSummary[]>;
      loadSkill: (skillName: string) => Promise<LoadedSkill>;
      readSkillResource: (request: { skillName: string; relativePath: string }) => Promise<SkillResourceResponse>;
      importSkill: (request: ImportSkillRequest) => Promise<ImportSkillResponse>;
      chooseSkillImportSource: () => Promise<string | null>;
      listChatSessions: (workspaceDir: string) => Promise<ChatSessionSummary[]>;
      getChatSessionMessages: (sessionId: string) => Promise<ChatHistoryMessage[]>;
      createChatSession: (request: CreateChatSessionRequest) => Promise<ChatSessionSummary>;
      saveChatSessionMessages: (request: SaveChatSessionMessagesRequest) => Promise<ChatSessionSummary>;
    };
  }
}

export {};
