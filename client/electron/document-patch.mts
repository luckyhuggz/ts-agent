import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { resolveWorkspacePath } from "./workspace.mjs";

export interface DesktopDocumentPatchRequest {
  patch: string;
}

export interface DesktopDocumentPatchFileResult {
  filePath: string;
  fileName: string;
  extension: string;
  action: "add" | "update";
  charCount: number;
}

export interface DesktopDocumentPatchResponse {
  applied: number;
  files: DesktopDocumentPatchFileResult[];
}

type PatchOperation =
  | {
      type: "add";
      filePath: string;
      content: string;
    }
  | {
      type: "update";
      filePath: string;
      hunks: PatchHunk[];
    };

interface PatchHunk {
  header: string;
  lines: string[];
}

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm"]);

export async function applyDocumentPatch(
  request: DesktopDocumentPatchRequest,
): Promise<DesktopDocumentPatchResponse> {
  const rawPatch = String(request.patch ?? "");
  if (!rawPatch.trim()) {
    throw new Error("patch is required.");
  }

  const operations = parsePatch(rawPatch);
  const files: DesktopDocumentPatchFileResult[] = [];

  for (const operation of operations) {
    const resolvedPath = resolveWorkspacePath(operation.filePath);
    const extension = extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(
        `Unsupported file type "${extension || "unknown"}". apply_patch_document supports .txt, .md, and .html files only.`,
      );
    }

    await mkdir(dirname(resolvedPath), { recursive: true });

    if (operation.type === "add") {
      const fileExists = await exists(resolvedPath);
      if (fileExists) {
        throw new Error(`Cannot add file because it already exists: ${resolvedPath}`);
      }

      const nextContent = normalizeContent(operation.content);
      await atomicWriteFile(resolvedPath, nextContent);
      files.push({
        filePath: resolvedPath,
        fileName: basename(resolvedPath),
        extension,
        action: "add",
        charCount: nextContent.length,
      });
      continue;
    }

    const fileExists = await exists(resolvedPath);
    if (!fileExists) {
      throw new Error(`Cannot update file because it does not exist: ${resolvedPath}`);
    }

    const currentContent = normalizeContent(await readFile(resolvedPath, "utf8"));
    const nextContent = applyHunks(currentContent, operation.hunks, resolvedPath);
    await atomicWriteFile(resolvedPath, nextContent);
    files.push({
      filePath: resolvedPath,
      fileName: basename(resolvedPath),
      extension,
      action: "update",
      charCount: nextContent.length,
    });
  }

  return {
    applied: files.length,
    files,
  };
}

function parsePatch(rawPatch: string): PatchOperation[] {
  const lines = normalizeContent(rawPatch).split("\n");
  if (lines[0] !== "*** Begin Patch") {
    throw new Error('Patch must start with "*** Begin Patch".');
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "*** End Patch") {
      return operations;
    }

    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      index += 1;
      const contentLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        if (currentLine.startsWith("*** ")) {
          break;
        }
        if (!currentLine.startsWith("+")) {
          throw new Error(`Add File lines must start with "+": ${currentLine}`);
        }
        contentLines.push(currentLine.slice(1));
        index += 1;
      }

      operations.push({
        type: "add",
        filePath,
        content: contentLines.join("\n"),
      });
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const filePath = line.slice("*** Update File: ".length).trim();
      index += 1;
      const hunks: PatchHunk[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        if (currentLine === "*** End Patch" || currentLine.startsWith("*** Add File: ") || currentLine.startsWith("*** Update File: ")) {
          break;
        }
        if (!currentLine.startsWith("@@")) {
          throw new Error(`Update File hunks must start with "@@": ${currentLine}`);
        }

        const header = currentLine;
        index += 1;
        const hunkLines: string[] = [];

        while (index < lines.length) {
          const hunkLine = lines[index];
          if (hunkLine.startsWith("@@") || hunkLine === "*** End Patch" || hunkLine.startsWith("*** Add File: ") || hunkLine.startsWith("*** Update File: ")) {
            break;
          }

          const prefix = hunkLine[0] ?? "";
          if (prefix !== " " && prefix !== "+" && prefix !== "-") {
            throw new Error(`Invalid patch line prefix "${prefix}" in hunk for ${filePath}.`);
          }

          hunkLines.push(hunkLine);
          index += 1;
        }

        hunks.push({ header, lines: hunkLines });
      }

      if (hunks.length === 0) {
        throw new Error(`Update File patch for ${filePath} must contain at least one hunk.`);
      }

      operations.push({
        type: "update",
        filePath,
        hunks,
      });
      continue;
    }

    throw new Error(`Unsupported patch operation line: ${line}`);
  }

  throw new Error('Patch must end with "*** End Patch".');
}

function applyHunks(content: string, hunks: PatchHunk[], filePath: string): string {
  const sourceLines = content.split("\n");
  const result: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const applyAt = findHunkPosition(sourceLines, hunk, cursor);
    if (applyAt === -1) {
      throw new Error(`Failed to apply patch hunk ${hunk.header} to ${filePath}.`);
    }

    result.push(...sourceLines.slice(cursor, applyAt));
    let sourceIndex = applyAt;

    for (const line of hunk.lines) {
      const prefix = line[0] ?? "";
      const value = line.slice(1);

      if (prefix === " ") {
        result.push(value);
        sourceIndex += 1;
        continue;
      }

      if (prefix === "-") {
        sourceIndex += 1;
        continue;
      }

      result.push(value);
    }

    cursor = sourceIndex;
  }

  result.push(...sourceLines.slice(cursor));
  return normalizeContent(result.join("\n"));
}

function findHunkPosition(sourceLines: string[], hunk: PatchHunk, startIndex: number): number {
  const anchorLines = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
  if (anchorLines.length === 0) {
    return startIndex;
  }

  for (let index = startIndex; index <= sourceLines.length; index += 1) {
    if (matchesHunkAt(sourceLines, hunk.lines, index)) {
      return index;
    }
  }

  return -1;
}

function matchesHunkAt(sourceLines: string[], hunkLines: string[], startIndex: number): boolean {
  let sourceIndex = startIndex;

  for (const line of hunkLines) {
    const prefix = line[0] ?? "";
    const value = line.slice(1);

    if (prefix === "+") {
      continue;
    }

    if (sourceLines[sourceIndex] !== value) {
      return false;
    }

    sourceIndex += 1;
  }

  return true;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const tempPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await writeFile(tempPath, content, "utf8");

    try {
      await rename(tempPath, targetPath);
    } catch {
      await rm(targetPath, { force: true });
      await rename(tempPath, targetPath);
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
