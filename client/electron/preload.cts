import { contextBridge, ipcRenderer } from "electron";

interface DesktopHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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

contextBridge.exposeInMainWorld("desktop", {
  httpRequest(request: DesktopHttpRequest): Promise<DesktopHttpResponse> {
    return ipcRenderer.invoke("desktop:http-request", request);
  },
  readDocument(request: DesktopDocumentReadRequest): Promise<DesktopDocumentReadResponse> {
    return ipcRenderer.invoke("desktop:read-document", request);
  },
  writeDocument(request: DesktopDocumentWriteRequest): Promise<DesktopDocumentWriteResponse> {
    return ipcRenderer.invoke("desktop:write-document", request);
  },
  runShellCommand(request: DesktopShellCommandRequest): Promise<DesktopShellCommandResponse> {
    return ipcRenderer.invoke("desktop:run-shell-command", request);
  },
});
