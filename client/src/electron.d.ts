export interface DesktopHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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

declare global {
  interface Window {
    desktop?: {
      httpRequest: (request: DesktopHttpRequest) => Promise<DesktopHttpResponse>;
      readDocument: (request: DesktopDocumentReadRequest) => Promise<DesktopDocumentReadResponse>;
      writeDocument: (request: DesktopDocumentWriteRequest) => Promise<DesktopDocumentWriteResponse>;
      runShellCommand: (request: DesktopShellCommandRequest) => Promise<DesktopShellCommandResponse>;
    };
  }
}

export {};
