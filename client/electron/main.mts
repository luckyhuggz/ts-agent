import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDocumentFile, type DesktopDocumentReadRequest, type DesktopDocumentReadResponse } from "./document-reader.mjs";
import { runShellCommand, type DesktopShellCommandRequest, type DesktopShellCommandResponse } from "./shell-command.mjs";
import { writeDocumentFile, type DesktopDocumentWriteRequest, type DesktopDocumentWriteResponse } from "./document-writer.mjs";

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
const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:1420";

function isSafeAppUrl(url: string): boolean {
  return url.startsWith("file://") || url.startsWith(rendererUrl);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "TS Agent Desktop",
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isSafeAppUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (app.isPackaged) {
    void window.loadFile(join(__dirname, "..", "dist", "index.html"));
  } else {
    void window.loadURL(rendererUrl);
  }

  return window;
}

function registerHttpBridge() {
  ipcMain.handle("desktop:http-request", async (_event, request: DesktopHttpRequest) => {
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
    });

    const payload: DesktopHttpResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };

    return payload;
  });

  ipcMain.handle("desktop:read-document", async (_event, request: DesktopDocumentReadRequest) => {
    const payload: DesktopDocumentReadResponse = await readDocumentFile(request);
    return payload;
  });

  ipcMain.handle("desktop:write-document", async (_event, request: DesktopDocumentWriteRequest) => {
    const payload: DesktopDocumentWriteResponse = await writeDocumentFile(request);
    return payload;
  });

  ipcMain.handle("desktop:run-shell-command", async (_event, request: DesktopShellCommandRequest) => {
    const payload: DesktopShellCommandResponse = await runShellCommand(request);
    return payload;
  });
}

app.whenReady().then(() => {
  registerHttpBridge();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
