import type {
  DesktopDocumentReadRequest,
  DesktopDocumentReadResponse,
  DesktopDocumentWriteRequest,
  DesktopDocumentWriteResponse,
  DesktopHttpRequest,
  DesktopHttpResponse,
  DesktopShellCommandRequest,
  DesktopShellCommandResponse,
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
