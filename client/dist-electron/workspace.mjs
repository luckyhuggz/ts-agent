import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
let currentWorkspaceDir = resolve(join(homedir(), ".luckyai"));
export function getDefaultWorkspaceDir() {
    return resolve(join(homedir(), ".luckyai"));
}
export function getCurrentWorkspaceDir() {
    return currentWorkspaceDir;
}
export function getSkillsDir(workspaceDir = currentWorkspaceDir) {
    return resolve(join(workspaceDir, ".agents", "skills"));
}
export async function ensureWorkspaceDir(workspaceDir = currentWorkspaceDir) {
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(getSkillsDir(workspaceDir), { recursive: true });
}
export async function setCurrentWorkspaceDir(workspaceDir) {
    const resolved = resolve(workspaceDir);
    currentWorkspaceDir = resolved;
    await ensureWorkspaceDir(resolved);
    return getWorkspaceInfo();
}
export async function getWorkspaceInfo() {
    await ensureWorkspaceDir(currentWorkspaceDir);
    return {
        defaultWorkspaceDir: getDefaultWorkspaceDir(),
        currentWorkspaceDir,
        skillsDir: getSkillsDir(currentWorkspaceDir),
    };
}
export function resolveWorkspacePath(targetPath) {
    const trimmed = String(targetPath ?? "").trim();
    if (!trimmed) {
        return currentWorkspaceDir;
    }
    return isAbsolute(trimmed) ? resolve(trimmed) : resolve(currentWorkspaceDir, trimmed);
}
