import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatSession, getChatSessionMessages, listChatSessions, saveChatSessionMessages, } from "./history.mjs";
import { readDocumentFile } from "./document-reader.mjs";
import { importSkill, listSkills, loadSkill, readSkillResource, } from "./skills.mjs";
import { runShellCommand } from "./shell-command.mjs";
import { writeDocumentFile } from "./document-writer.mjs";
import { ensureWorkspaceDir, getWorkspaceInfo, setCurrentWorkspaceDir } from "./workspace.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:1420";
function isSafeAppUrl(url) {
    return url.startsWith("file://") || url.startsWith(rendererUrl);
}
function createMainWindow() {
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
    }
    else {
        void window.loadURL(rendererUrl);
    }
    return window;
}
function registerHttpBridge() {
    const streamControllers = new Map();
    ipcMain.handle("desktop:http-request", async (_event, request) => {
        const response = await fetch(request.url, {
            method: request.method ?? "GET",
            headers: request.headers,
            body: request.body,
        });
        const payload = {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text(),
        };
        return payload;
    });
    ipcMain.on("desktop:http-stream-start", async (event, request) => {
        const controller = new AbortController();
        const chunkChannel = `desktop:http-stream:${request.streamId}:chunk`;
        const endChannel = `desktop:http-stream:${request.streamId}:end`;
        const errorChannel = `desktop:http-stream:${request.streamId}:error`;
        streamControllers.set(request.streamId, controller);
        try {
            const response = await fetch(request.url, {
                method: request.method ?? "GET",
                headers: request.headers,
                body: request.body,
                signal: controller.signal,
            });
            if (!response.ok || !response.body) {
                const body = await response.text();
                event.sender.send(errorChannel, {
                    name: "HttpStreamError",
                    message: `Streaming request failed (${response.status}): ${body}`,
                });
                return;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                if (chunk) {
                    event.sender.send(chunkChannel, chunk);
                }
            }
            const trailingChunk = decoder.decode();
            if (trailingChunk) {
                event.sender.send(chunkChannel, trailingChunk);
            }
            const payload = {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: "",
            };
            event.sender.send(endChannel, payload);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const name = error instanceof Error && error.name === "AbortError" ? "AbortError" : "HttpStreamError";
            event.sender.send(errorChannel, { name, message });
        }
        finally {
            streamControllers.delete(request.streamId);
        }
    });
    ipcMain.on("desktop:http-stream-abort", (_event, streamId) => {
        streamControllers.get(streamId)?.abort();
    });
    ipcMain.handle("desktop:read-document", async (_event, request) => {
        const payload = await readDocumentFile(request);
        return payload;
    });
    ipcMain.handle("desktop:write-document", async (_event, request) => {
        const payload = await writeDocumentFile(request);
        return payload;
    });
    ipcMain.handle("desktop:run-shell-command", async (_event, request) => {
        const payload = await runShellCommand(request);
        return payload;
    });
    ipcMain.handle("desktop:get-workspace-info", async () => {
        const payload = await getWorkspaceInfo();
        return payload;
    });
    ipcMain.handle("desktop:set-workspace", async (_event, workspaceDir) => {
        const payload = await setCurrentWorkspaceDir(workspaceDir);
        return payload;
    });
    ipcMain.handle("desktop:choose-workspace", async () => {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const result = await dialog.showOpenDialog(window, {
            title: "选择工作目录",
            defaultPath: (await getWorkspaceInfo()).currentWorkspaceDir,
            properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return setCurrentWorkspaceDir(result.filePaths[0]);
    });
    ipcMain.handle("desktop:list-skills", async () => {
        const payload = await listSkills();
        return payload;
    });
    ipcMain.handle("desktop:load-skill", async (_event, skillName) => {
        const payload = await loadSkill(skillName);
        return payload;
    });
    ipcMain.handle("desktop:read-skill-resource", async (_event, request) => {
        const payload = await readSkillResource(request.skillName, request.relativePath);
        return payload;
    });
    ipcMain.handle("desktop:import-skill", async (_event, request) => {
        const payload = await importSkill(request);
        return payload;
    });
    ipcMain.handle("desktop:choose-skill-import-source", async () => {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const result = await dialog.showOpenDialog(window, {
            title: "选择 Skill 文件夹或 SKILL.md",
            defaultPath: (await getWorkspaceInfo()).currentWorkspaceDir,
            properties: ["openFile", "openDirectory", "createDirectory"],
            filters: [
                { name: "Markdown", extensions: ["md"] },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });
    ipcMain.handle("desktop:list-chat-sessions", async (_event, workspaceDir) => {
        const payload = listChatSessions(workspaceDir);
        return payload;
    });
    ipcMain.handle("desktop:get-chat-session-messages", async (_event, sessionId) => {
        const payload = getChatSessionMessages(sessionId);
        return payload;
    });
    ipcMain.handle("desktop:create-chat-session", async (_event, request) => {
        const payload = createChatSession(request);
        return payload;
    });
    ipcMain.handle("desktop:save-chat-session-messages", async (_event, request) => {
        const payload = saveChatSessionMessages(request);
        return payload;
    });
}
app.whenReady().then(() => {
    void ensureWorkspaceDir();
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
