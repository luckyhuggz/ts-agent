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

contextBridge.exposeInMainWorld("desktop", {
  httpRequest(request: DesktopHttpRequest): Promise<DesktopHttpResponse> {
    return ipcRenderer.invoke("desktop:http-request", request);
  },
});
