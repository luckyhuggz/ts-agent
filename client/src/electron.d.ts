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

declare global {
  interface Window {
    desktop?: {
      httpRequest: (request: DesktopHttpRequest) => Promise<DesktopHttpResponse>;
    };
  }
}

export {};
