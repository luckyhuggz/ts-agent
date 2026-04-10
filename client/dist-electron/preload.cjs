"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktop", {
    httpRequest(request) {
        return electron_1.ipcRenderer.invoke("desktop:http-request", request);
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
});
