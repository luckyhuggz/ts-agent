import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { resolveWorkspacePath } from "./workspace.mjs";

export interface DesktopDocumentWriteRequest {
  filePath: string;
  content?: string;
  appendContent?: string;
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

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm", ".docx"]);

export async function writeDocumentFile(
  request: DesktopDocumentWriteRequest,
): Promise<DesktopDocumentWriteResponse> {
  const inputPath = String(request.filePath ?? "").trim();
  if (!inputPath) {
    throw new Error("filePath is required.");
  }

  const resolvedPath = resolveWorkspacePath(inputPath);
  const extension = extname(resolvedPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type "${extension || "unknown"}". Supported: .txt, .md, .html, .docx`);
  }

  await mkdir(dirname(resolvedPath), { recursive: true });

  if (extension === ".docx") {
    if (
      request.oldString !== undefined ||
      request.newString !== undefined ||
      request.appendContent !== undefined
    ) {
      throw new Error("docx only supports full content overwrite. Use the content field instead of oldString/newString or appendContent.");
    }

    const content = normalizeContent(String(request.content ?? ""));
    const buffer = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: toDocxParagraphs(content),
          },
        ],
      }),
    );
    await atomicWriteFile(resolvedPath, buffer);

    return {
      filePath: resolvedPath,
      fileName: basename(resolvedPath),
      extension,
      charCount: content.length,
      mode: "overwrite",
      replacedCount: 0,
    };
  }

  const oldString = request.oldString;
  const newString = request.newString;
  const appendContent = request.appendContent;

  if (appendContent !== undefined) {
    if (oldString !== undefined || newString !== undefined) {
      throw new Error("appendContent cannot be combined with oldString/newString.");
    }

    const normalizedAppendContent = normalizeContent(appendContent);
    await writeFile(resolvedPath, normalizedAppendContent, {
      encoding: "utf8",
      flag: "a",
    });

    const finalContent = normalizeContent(await readFile(resolvedPath, "utf8"));
    return {
      filePath: resolvedPath,
      fileName: basename(resolvedPath),
      extension,
      charCount: finalContent.length,
      mode: "overwrite",
      replacedCount: 0,
    };
  }

  if (oldString !== undefined || newString !== undefined) {
    if (typeof oldString !== "string" || typeof newString !== "string") {
      throw new Error("oldString and newString must both be provided for text replacement.");
    }
    if (!oldString) {
      throw new Error("oldString must not be empty for text replacement.");
    }

    const existingContent = normalizeContent(await readFile(resolvedPath, "utf8"));
    const replacement = normalizeContent(newString);
    const { content, replacedCount } = replaceText(existingContent, oldString, replacement, request.replaceAll === true);
    if (replacedCount === 0) {
      throw new Error("oldString was not found in the document.");
    }

    await atomicWriteFile(resolvedPath, content, "utf8");
    return {
      filePath: resolvedPath,
      fileName: basename(resolvedPath),
      extension,
      charCount: content.length,
      mode: "replace_text",
      replacedCount,
    };
  } else {
    const content = normalizeContent(String(request.content ?? ""));
    await atomicWriteFile(resolvedPath, content, "utf8");

    return {
      filePath: resolvedPath,
      fileName: basename(resolvedPath),
      extension,
      charCount: content.length,
      mode: "overwrite",
      replacedCount: 0,
    };
  }
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  encoding?: BufferEncoding,
): Promise<void> {
  const tempPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    if (typeof content === "string") {
      await writeFile(tempPath, content, encoding ?? "utf8");
    } else {
      await writeFile(tempPath, content);
    }

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

function toDocxParagraphs(content: string): Paragraph[] {
  if (!content) {
    return [new Paragraph("")];
  }

  return content.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const children: TextRun[] = [];

    lines.forEach((line, index) => {
      children.push(
        new TextRun({
          text: line,
          break: index === 0 ? 0 : 1,
        }),
      );
    });

    return new Paragraph({ children });
  });
}

function replaceText(
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): { content: string; replacedCount: number } {
  if (replaceAll) {
    const parts = source.split(oldString);
    const replacedCount = parts.length - 1;
    return {
      content: parts.join(newString),
      replacedCount,
    };
  }

  const index = source.indexOf(oldString);
  if (index === -1) {
    return { content: source, replacedCount: 0 };
  }

  return {
    content: `${source.slice(0, index)}${newString}${source.slice(index + oldString.length)}`,
    replacedCount: 1,
  };
}
