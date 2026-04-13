import type {
  ChatHistoryMessage,
  ChatSessionSummary,
  DesktopDocumentPatchRequest,
  DesktopDocumentPatchResponse,
  CreateChatSessionRequest,
  DesktopDocumentReadRequest,
  DesktopDocumentReadResponse,
  DesktopDocumentWriteRequest,
  DesktopDocumentWriteResponse,
  DesktopHttpRequest,
  DesktopHttpResponse,
  DesktopHttpStreamRequest,
  ImportSkillRequest,
  ImportSkillResponse,
  LoadedSkill,
  DesktopShellCommandRequest,
  DesktopShellCommandResponse,
  SaveChatSessionMessagesRequest,
  SkillResourceResponse,
  SkillSummary,
  WorkspaceInfo,
} from "@/electron.d";

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

class IpcHttpResponse implements HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;

  constructor(private readonly response: DesktopHttpResponse) {
    this.ok = response.ok;
    this.status = response.status;
    this.statusText = response.statusText;
  }

  async text(): Promise<string> {
    return this.response.body;
  }

  async json<T>(): Promise<T> {
    return JSON.parse(this.response.body) as T;
  }
}

export async function httpFetch(url: string, init: RequestInit = {}): Promise<HttpResponseLike> {
  if (typeof window !== "undefined" && window.desktop?.httpRequest) {
    const response = await window.desktop.httpRequest(toDesktopRequest(url, init));
    return new IpcHttpResponse(response);
  }

  return globalThis.fetch(url, init);
}

export interface HttpStreamResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export async function httpFetchStream(
  url: string,
  init: RequestInit = {},
  options: {
    onChunk: (chunk: string) => void;
  },
): Promise<HttpStreamResponseLike> {
  if (typeof window !== "undefined" && window.desktop?.httpRequestStream) {
    const streamId = createStreamId();
    const request: DesktopHttpStreamRequest = {
      ...toDesktopRequest(url, init),
      streamId,
    };

    const abort = () => {
      window.desktop?.abortHttpRequestStream(streamId);
    };

    if (init.signal?.aborted) {
      abort();
      throw createAbortError();
    }

    const handleAbort = () => abort();
    init.signal?.addEventListener("abort", handleAbort, { once: true });

    try {
      const response = await window.desktop.httpRequestStream(request, options.onChunk);
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } finally {
      init.signal?.removeEventListener("abort", handleAbort);
    }
  }

  const response = await globalThis.fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Streaming request failed (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        options.onChunk(chunk);
      }
    }

    const trailingChunk = decoder.decode();
    if (trailingChunk) {
      options.onChunk(trailingChunk);
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

export async function readDocumentFile(filePath: string): Promise<DesktopDocumentReadResponse> {
  const request: DesktopDocumentReadRequest = { filePath };

  if (typeof window === "undefined" || !window.desktop?.readDocument) {
    throw new Error("Document reading is only available in the Electron desktop app.");
  }

  return window.desktop.readDocument(request);
}

export async function writeDocumentFile(
  filePath: string,
  options: {
    content?: string;
    appendContent?: string;
    oldString?: string;
    newString?: string;
    replaceAll?: boolean;
  },
): Promise<DesktopDocumentWriteResponse> {
  const request: DesktopDocumentWriteRequest = { filePath, ...options };

  if (typeof window === "undefined" || !window.desktop?.writeDocument) {
    throw new Error("Document writing is only available in the Electron desktop app.");
  }

  return window.desktop.writeDocument(request);
}

export async function applyDocumentPatch(patch: string): Promise<DesktopDocumentPatchResponse> {
  const request: DesktopDocumentPatchRequest = { patch };

  if (typeof window === "undefined" || !window.desktop?.applyDocumentPatch) {
    throw new Error("Document patching is only available in the Electron desktop app.");
  }

  return window.desktop.applyDocumentPatch(request);
}

export async function runShellCommand(options: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<DesktopShellCommandResponse> {
  const request: DesktopShellCommandRequest = options;

  if (typeof window === "undefined" || !window.desktop?.runShellCommand) {
    throw new Error("Shell commands are only available in the Electron desktop app.");
  }

  return window.desktop.runShellCommand(request);
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  if (typeof window === "undefined" || !window.desktop?.getWorkspaceInfo) {
    throw new Error("Workspace management is only available in the Electron desktop app.");
  }
  return window.desktop.getWorkspaceInfo();
}

export async function setWorkspace(workspaceDir: string): Promise<WorkspaceInfo> {
  if (typeof window === "undefined" || !window.desktop?.setWorkspace) {
    throw new Error("Workspace management is only available in the Electron desktop app.");
  }
  return window.desktop.setWorkspace(workspaceDir);
}

export async function chooseWorkspace(): Promise<WorkspaceInfo | null> {
  if (typeof window === "undefined" || !window.desktop?.chooseWorkspace) {
    throw new Error("Workspace management is only available in the Electron desktop app.");
  }
  return window.desktop.chooseWorkspace();
}

export async function listSkills(): Promise<SkillSummary[]> {
  if (typeof window === "undefined" || !window.desktop?.listSkills) {
    throw new Error("Skills are only available in the Electron desktop app.");
  }
  return window.desktop.listSkills();
}

export async function loadSkill(skillName: string): Promise<LoadedSkill> {
  if (typeof window === "undefined" || !window.desktop?.loadSkill) {
    throw new Error("Skills are only available in the Electron desktop app.");
  }
  return window.desktop.loadSkill(skillName);
}

export async function readSkillResource(request: {
  skillName: string;
  relativePath: string;
}): Promise<SkillResourceResponse> {
  if (typeof window === "undefined" || !window.desktop?.readSkillResource) {
    throw new Error("Skills are only available in the Electron desktop app.");
  }
  return window.desktop.readSkillResource(request);
}

export async function importSkill(request: ImportSkillRequest): Promise<ImportSkillResponse> {
  if (typeof window === "undefined" || !window.desktop?.importSkill) {
    throw new Error("Skills are only available in the Electron desktop app.");
  }
  return window.desktop.importSkill(request);
}

export async function chooseSkillImportSource(): Promise<string | null> {
  if (typeof window === "undefined" || !window.desktop?.chooseSkillImportSource) {
    throw new Error("Skills are only available in the Electron desktop app.");
  }
  return window.desktop.chooseSkillImportSource();
}

export async function listChatSessions(workspaceDir: string): Promise<ChatSessionSummary[]> {
  if (typeof window === "undefined" || !window.desktop?.listChatSessions) {
    throw new Error("Chat history is only available in the Electron desktop app.");
  }
  return window.desktop.listChatSessions(workspaceDir);
}

export async function getChatSessionMessages(sessionId: string): Promise<ChatHistoryMessage[]> {
  if (typeof window === "undefined" || !window.desktop?.getChatSessionMessages) {
    throw new Error("Chat history is only available in the Electron desktop app.");
  }
  return window.desktop.getChatSessionMessages(sessionId);
}

export async function createChatSession(request: CreateChatSessionRequest): Promise<ChatSessionSummary> {
  if (typeof window === "undefined" || !window.desktop?.createChatSession) {
    throw new Error("Chat history is only available in the Electron desktop app.");
  }
  return window.desktop.createChatSession(request);
}

export async function saveChatSessionMessages(
  request: SaveChatSessionMessagesRequest,
): Promise<ChatSessionSummary> {
  if (typeof window === "undefined" || !window.desktop?.saveChatSessionMessages) {
    throw new Error("Chat history is only available in the Electron desktop app.");
  }
  return window.desktop.saveChatSessionMessages(request);
}

function toDesktopRequest(url: string, init: RequestInit): DesktopHttpRequest {
  return {
    url,
    method: init.method,
    headers: normalizeHeaders(init.headers),
    body: typeof init.body === "string" ? init.body : undefined,
  };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function createStreamId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
