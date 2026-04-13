import { writeDocumentFile } from "@/lib/desktop";

export interface FileWriteBlock {
  filePath: string;
  mode: "overwrite" | "append";
  content: string;
  raw: string;
}

export interface FileWriteBlockResult {
  applied: boolean;
  cleanedContent: string;
  summaryLines: string[];
  writes: Array<
    | {
        ok: true;
        filePath: string;
        mode: "overwrite" | "append";
        charCount: number;
      }
    | {
        ok: false;
        filePath: string;
        mode: "overwrite" | "append";
        error: string;
      }
  >;
}

const BLOCK_PATTERN = /<lucky-file\b([^>]*)>([\s\S]*?)<\/lucky-file>/gi;
const ATTRIBUTE_PATTERN = /(\w+)="([^"]*)"/g;

export async function applyAssistantFileWriteBlocks(content: string): Promise<FileWriteBlockResult> {
  const matches = [...content.matchAll(BLOCK_PATTERN)];
  if (matches.length === 0) {
    return {
      applied: false,
      cleanedContent: content,
      summaryLines: [],
      writes: [],
    };
  }

  const blocks = matches
    .map((match) => parseFileWriteBlock(match[0], match[1] ?? "", match[2] ?? ""))
    .filter((block): block is FileWriteBlock => block !== null);

  const writes: FileWriteBlockResult["writes"] = [];
  for (const block of blocks) {
    try {
      const result =
        block.mode === "append"
          ? await writeDocumentFile(block.filePath, { appendContent: block.content })
          : await writeDocumentFile(block.filePath, { content: block.content });

      writes.push({
        ok: true,
        filePath: result.filePath,
        mode: block.mode,
        charCount: result.charCount,
      });
    } catch (error) {
      writes.push({
        ok: false,
        filePath: block.filePath,
        mode: block.mode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const placeholderContent = content.replace(BLOCK_PATTERN, (_raw, attrs) => {
    const attributes = parseAttributes(String(attrs ?? ""));
    const filePath = attributes.path || attributes.filePath || "unknown";
    const mode = normalizeMode(attributes.mode);
    return `\n[Local file output captured: ${filePath} (${mode})]\n`;
  });

  const summaryLines = writes.map((write) =>
    write.ok
      ? `- 已写入文件: ${write.filePath} (${write.mode}, ${write.charCount} chars)`
      : `- 文件写入失败: ${write.filePath} (${write.mode}) - ${write.error}`,
  );

  const cleanedText = placeholderContent.trim();
  const cleanedContent = cleanedText
    ? `${cleanedText}\n\n文件写入结果：\n${summaryLines.join("\n")}`.trim()
    : `文件写入结果：\n${summaryLines.join("\n")}`;

  return {
    applied: true,
    cleanedContent,
    summaryLines,
    writes,
  };
}

function parseFileWriteBlock(raw: string, rawAttributes: string, rawContent: string): FileWriteBlock | null {
  const attributes = parseAttributes(rawAttributes);
  const filePath = attributes.path || attributes.filePath;
  if (!filePath) {
    return null;
  }

  return {
    filePath,
    mode: normalizeMode(attributes.mode),
    content: normalizeBlockContent(rawContent),
    raw,
  };
}

function parseAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = ATTRIBUTE_PATTERN.exec(rawAttributes)) !== null) {
    attributes[match[1]] = match[2];
  }

  ATTRIBUTE_PATTERN.lastIndex = 0;
  return attributes;
}

function normalizeMode(mode: string | undefined): "overwrite" | "append" {
  return String(mode ?? "").toLowerCase() === "append" ? "append" : "overwrite";
}

function normalizeBlockContent(content: string): string {
  let next = content.replace(/\r\n?/g, "\n");
  if (next.startsWith("\n")) {
    next = next.slice(1);
  }
  if (next.endsWith("\n")) {
    next = next.slice(0, -1);
  }
  return next;
}
