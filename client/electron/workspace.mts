import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface WorkspaceInfo {
  defaultWorkspaceDir: string;
  currentWorkspaceDir: string;
  skillsDir: string;
}

let currentWorkspaceDir = resolve(join(homedir(), ".luckyai"));

export function getDefaultWorkspaceDir(): string {
  return resolve(join(homedir(), ".luckyai"));
}

export function getCurrentWorkspaceDir(): string {
  return currentWorkspaceDir;
}

export function getSkillsDir(workspaceDir = currentWorkspaceDir): string {
  return resolve(join(workspaceDir, ".agents", "skills"));
}

export async function ensureWorkspaceDir(workspaceDir = currentWorkspaceDir): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(getSkillsDir(workspaceDir), { recursive: true });
}

export async function setCurrentWorkspaceDir(workspaceDir: string): Promise<WorkspaceInfo> {
  const resolved = resolve(workspaceDir);
  currentWorkspaceDir = resolved;
  await ensureWorkspaceDir(resolved);
  return getWorkspaceInfo();
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  await ensureWorkspaceDir(currentWorkspaceDir);
  return {
    defaultWorkspaceDir: getDefaultWorkspaceDir(),
    currentWorkspaceDir,
    skillsDir: getSkillsDir(currentWorkspaceDir),
  };
}

export function resolveWorkspacePath(targetPath: string): string {
  const trimmed = String(targetPath ?? "").trim();
  if (!trimmed) {
    return currentWorkspaceDir;
  }
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(currentWorkspaceDir, trimmed);
}
