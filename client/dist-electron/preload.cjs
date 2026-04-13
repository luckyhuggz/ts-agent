"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktop", {
    httpRequest(request) {
        return electron_1.ipcRenderer.invoke("desktop:http-request", request);
    },
    httpRequestStream(request, onChunk) {
        const chunkChannel = `desktop:http-stream:${request.streamId}:chunk`;
        const endChannel = `desktop:http-stream:${request.streamId}:end`;
        const errorChannel = `desktop:http-stream:${request.streamId}:error`;
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                electron_1.ipcRenderer.removeAllListeners(chunkChannel);
                electron_1.ipcRenderer.removeAllListeners(endChannel);
                electron_1.ipcRenderer.removeAllListeners(errorChannel);
            };
            electron_1.ipcRenderer.on(chunkChannel, (_event, chunk) => {
                onChunk(chunk);
            });
            electron_1.ipcRenderer.once(endChannel, (_event, response) => {
                cleanup();
                resolve(response);
            });
            electron_1.ipcRenderer.once(errorChannel, (_event, error) => {
                cleanup();
                const nextError = new Error(error.message ?? "Streaming request failed.");
                nextError.name = error.name ?? "Error";
                reject(nextError);
            });
            electron_1.ipcRenderer.send("desktop:http-stream-start", request);
        });
    },
    abortHttpRequestStream(streamId) {
        electron_1.ipcRenderer.send("desktop:http-stream-abort", streamId);
    },
    readDocument(request) {
        return electron_1.ipcRenderer.invoke("desktop:read-document", request);
    },
    writeDocument(request) {
        return electron_1.ipcRenderer.invoke("desktop:write-document", request);
    },
    runShellCommand(request) {
        return electron_1.ipcRenderer.invoke("desktop:run-shell-command", request);
    },
    getWorkspaceInfo() {
        return electron_1.ipcRenderer.invoke("desktop:get-workspace-info");
    },
    setWorkspace(workspaceDir) {
        return electron_1.ipcRenderer.invoke("desktop:set-workspace", workspaceDir);
    },
    chooseWorkspace() {
        return electron_1.ipcRenderer.invoke("desktop:choose-workspace");
    },
    listSkills() {
        return electron_1.ipcRenderer.invoke("desktop:list-skills");
    },
    loadSkill(skillName) {
        return electron_1.ipcRenderer.invoke("desktop:load-skill", skillName);
    },
    readSkillResource(request) {
        return electron_1.ipcRenderer.invoke("desktop:read-skill-resource", request);
    },
    importSkill(request) {
        return electron_1.ipcRenderer.invoke("desktop:import-skill", request);
    },
    chooseSkillImportSource() {
        return electron_1.ipcRenderer.invoke("desktop:choose-skill-import-source");
    },
    listChatSessions(workspaceDir) {
        return electron_1.ipcRenderer.invoke("desktop:list-chat-sessions", workspaceDir);
    },
    getChatSessionMessages(sessionId) {
        return electron_1.ipcRenderer.invoke("desktop:get-chat-session-messages", sessionId);
    },
    createChatSession(request) {
        return electron_1.ipcRenderer.invoke("desktop:create-chat-session", request);
    },
    saveChatSessionMessages(request) {
        return electron_1.ipcRenderer.invoke("desktop:save-chat-session-messages", request);
    },
});
