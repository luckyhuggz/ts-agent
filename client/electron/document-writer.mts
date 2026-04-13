import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import {
  AlignmentType,
  Document,
  FileChild,
  Footer,
  HeadingLevel,
  Header,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
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
    const title = extractDocumentTitle(content, basename(resolvedPath, extension));
    const buffer = await Packer.toBuffer(
      new Document({
        styles: {
          default: {
            document: {
              run: {
                font: {
                  ascii: "Calibri",
                  hAnsi: "Calibri",
                  eastAsia: "Microsoft YaHei",
                },
                size: 24,
                color: "1F2937",
              },
              paragraph: {
                spacing: {
                  line: 360,
                  after: 160,
                },
              },
            },
            title: {
              run: {
                size: 36,
                bold: true,
                color: "111827",
              },
              paragraph: {
                spacing: {
                  before: 120,
                  after: 240,
                },
              },
            },
            heading1: {
              run: {
                size: 32,
                bold: true,
                color: "111827",
              },
              paragraph: {
                spacing: {
                  before: 240,
                  after: 160,
                },
              },
            },
            heading2: {
              run: {
                size: 28,
                bold: true,
                color: "111827",
              },
              paragraph: {
                spacing: {
                  before: 180,
                  after: 120,
                },
              },
            },
            heading3: {
              run: {
                size: 26,
                bold: true,
                color: "111827",
              },
              paragraph: {
                spacing: {
                  before: 160,
                  after: 120,
                },
              },
            },
            listParagraph: {
              paragraph: {
                spacing: {
                  after: 80,
                },
              },
            },
          },
        },
        numbering: {
          config: [
            ...createOrderedListLevels(),
          ],
        },
        sections: [
          {
            headers: {
              default: createDocumentHeader(title),
            },
            footers: {
              default: createDocumentFooter(),
            },
            properties: {
              page: {
                margin: {
                  top: 1440,
                  right: 1440,
                  bottom: 1440,
                  left: 1440,
                  header: 720,
                  footer: 720,
                },
              },
            },
            children: toDocxChildren(content),
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

function toDocxChildren(content: string): FileChild[] {
  if (!content) {
    return [new Paragraph("")];
  }

  const children: FileChild[] = [];
  const blocks = content.split(/\n{2,}/);

  blocks.forEach((block, blockIndex) => {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      return;
    }

    const titleMatch = blockIndex === 0 ? trimmedBlock.match(/^#\s+(.+)$/) : null;
    if (titleMatch) {
      children.push(
        new Paragraph({
          children: toInlineRuns(titleMatch[1].trim()),
          heading: HeadingLevel.TITLE,
        }),
      );
      return;
    }

    const headingMatch = trimmedBlock.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      children.push(
        new Paragraph({
          children: toInlineRuns(headingMatch[2].trim()),
          heading: toHeadingLevel(headingMatch[1].length),
        }),
      );
      return;
    }

    if (isMarkdownTableBlock(trimmedBlock)) {
      children.push(toMarkdownTable(trimmedBlock));
      return;
    }

    if (isBulletBlock(trimmedBlock)) {
      children.push(...toBulletParagraphs(trimmedBlock));
      return;
    }

    if (isOrderedListBlock(trimmedBlock)) {
      children.push(...toOrderedListParagraphs(trimmedBlock));
      return;
    }

    if (isQuoteBlock(trimmedBlock)) {
      children.push(toQuoteParagraph(trimmedBlock));
      return;
    }

    const lines = block.split("\n");
    const paragraphChildren: TextRun[] = [];

    lines.forEach((line, index) => {
      const runs = toInlineRuns(line.trimEnd());
      if (index > 0) {
        paragraphChildren.push(new TextRun({ text: "", break: 1 }));
      }
      paragraphChildren.push(...runs);
    });

    children.push(
      new Paragraph({
        children: paragraphChildren,
      }),
    );
  });

  return children.length > 0 ? children : [new Paragraph("")];
}

function toHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

function isBulletBlock(block: string): boolean {
  return block.split("\n").every((line) => /^\s*[-*]\s+.+$/.test(line));
}

function toBulletParagraphs(block: string): Paragraph[] {
  return block.split("\n").map((line) => {
    const match = line.match(/^(\s*)[-*]\s+(.+)$/);
    const indentLevel = Math.min(Math.floor((match?.[1].length ?? 0) / 2), 7);

    return new Paragraph({
      children: toInlineRuns(match?.[2].trim() ?? line.trim()),
      bullet: {
        level: indentLevel,
      },
    });
  });
}

function isOrderedListBlock(block: string): boolean {
  return block.split("\n").every((line) => /^\s*\d+\.\s+.+$/.test(line));
}

function toOrderedListParagraphs(block: string): Paragraph[] {
  return block.split("\n").map((line) => {
    const match = line.match(/^(\s*)\d+\.\s+(.+)$/);
    const indentLevel = Math.min(Math.floor((match?.[1].length ?? 0) / 2), 7);

    return new Paragraph({
      children: toInlineRuns(match?.[2].trim() ?? line.trim()),
      numbering: {
        reference: "ordered-list",
        level: indentLevel,
      },
    });
  });
}

function isQuoteBlock(block: string): boolean {
  return block.split("\n").every((line) => /^\s*>\s?.+$/.test(line));
}

function toQuoteParagraph(block: string): Paragraph {
  const lines = block.split("\n").map((line) => line.replace(/^\s*>\s?/, ""));
  const children: TextRun[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      children.push(new TextRun({ text: "", break: 1 }));
    }
    children.push(...toInlineRuns(line.trimEnd(), { italics: true, color: "4B5563" }));
  });

  return new Paragraph({
    children,
    indent: {
      left: 480,
    },
    border: {
      left: {
        color: "D1D5DB",
        size: 12,
        space: 12,
        style: "single",
      },
    },
    spacing: {
      before: 80,
      after: 120,
    },
  });
}

function createOrderedListLevels(): { reference: string; levels: { level: number; format: "decimal"; text: string; alignment: typeof AlignmentType.START; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] {
  return [
    {
      reference: "ordered-list",
      levels: Array.from({ length: 8 }, (_, level) => ({
        level,
        format: "decimal" as const,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: {
          paragraph: {
            indent: {
              left: 720 + level * 360,
              hanging: 360,
            },
          },
        },
      })),
    },
  ];
}

function extractDocumentTitle(content: string, fallbackTitle: string): string {
  const titleMatch = content.match(/^\s*#\s+(.+)$/m);
  return titleMatch?.[1]?.trim() || fallbackTitle;
}

function createDocumentHeader(title: string): Header {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: {
          bottom: {
            color: "D1D5DB",
            size: 6,
            space: 1,
            style: "single",
          },
        },
        spacing: {
          after: 120,
        },
        children: [
          new TextRun({
            text: title,
            size: 18,
            color: "6B7280",
          }),
        ],
      }),
    ],
  });
}

function createDocumentFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: {
          before: 120,
        },
        children: [
          new TextRun({
            size: 18,
            color: "6B7280",
            children: ["第 ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
          }),
        ],
      }),
    ],
  });
}

function isMarkdownTableBlock(block: string): boolean {
  const lines = block.split("\n").map((line) => line.trim());
  if (lines.length < 2) {
    return false;
  }

  if (!lines.every((line) => line.includes("|"))) {
    return false;
  }

  const separatorLine = normalizeTableLine(lines[1]);
  return /^:?-{3,}:?(?:\|:?-{3,}:?)*$/.test(separatorLine);
}

function toMarkdownTable(block: string): Table {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines.map((line) => splitMarkdownTableRow(line));
  const headerCells = rows[0];
  const bodyRows = rows.slice(2);
  const columnCount = headerCells.length;

  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    columnWidths: Array.from({ length: columnCount }, () => 100 / columnCount),
    borders: {
      top: { color: "CBD5E1", size: 8, style: "single" },
      bottom: { color: "CBD5E1", size: 8, style: "single" },
      left: { color: "CBD5E1", size: 8, style: "single" },
      right: { color: "CBD5E1", size: 8, style: "single" },
      insideHorizontal: { color: "CBD5E1", size: 6, style: "single" },
      insideVertical: { color: "CBD5E1", size: 6, style: "single" },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerCells.map((cell) => createTableCell(cell, true)),
      }),
      ...bodyRows.map(
        (row) =>
          new TableRow({
            children: normalizeRowLength(row, columnCount).map((cell) => createTableCell(cell, false)),
          }),
      ),
    ],
  });
}

function normalizeTableLine(line: string): string {
  return line.replace(/^\|/, "").replace(/\|$/, "").replace(/\s+/g, "");
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeRowLength(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) {
    return row.slice(0, columnCount);
  }

  return [...row, ...Array.from({ length: columnCount - row.length }, () => "")];
}

function createTableCell(text: string, isHeader: boolean): TableCell {
  return new TableCell({
    shading: isHeader
      ? {
          fill: "E5E7EB",
        }
      : undefined,
    margins: {
      top: 80,
      bottom: 80,
      left: 100,
      right: 100,
    },
    children: [
      new Paragraph({
        children: toInlineRuns(text, isHeader ? { bold: true } : undefined),
      }),
    ],
  });
}

function toInlineRuns(text: string, baseStyle: InlineStyle = {}): TextRun[] {
  return parseInlineMarkdown(text, baseStyle).map(
    (segment) =>
      new TextRun({
        text: segment.text,
        ...segment.style,
      }),
  );
}

function parseInlineMarkdown(text: string, baseStyle: InlineStyle): InlineSegment[] {
  if (!text) {
    return [createInlineSegment("", baseStyle)];
  }

  const tokens = ["***", "___", "**", "__", "*", "_"] as const;
  const nextToken = findNextInlineToken(text, tokens);
  if (!nextToken) {
    return [createInlineSegment(text, baseStyle)];
  }

  const segments: InlineSegment[] = [];
  if (nextToken.index > 0) {
    segments.push(createInlineSegment(text.slice(0, nextToken.index), baseStyle));
  }

  const contentStart = nextToken.index + nextToken.token.length;
  const closingIndex = text.indexOf(nextToken.token, contentStart);
  if (closingIndex === -1) {
    segments.push(createInlineSegment(text.slice(nextToken.index), baseStyle));
    return segments;
  }

  const innerText = text.slice(contentStart, closingIndex);
  if (!innerText) {
    segments.push(createInlineSegment(nextToken.token + nextToken.token, baseStyle));
  } else {
    const nextStyle = applyInlineTokenStyle(baseStyle, nextToken.token);
    segments.push(...parseInlineMarkdown(innerText, nextStyle));
  }

  const remainingText = text.slice(closingIndex + nextToken.token.length);
  if (remainingText) {
    segments.push(...parseInlineMarkdown(remainingText, baseStyle));
  }

  return segments;
}

function findNextInlineToken(text: string, tokens: readonly string[]): { index: number; token: string } | null {
  let bestMatch: { index: number; token: string } | null = null;

  tokens.forEach((token) => {
    const index = text.indexOf(token);
    if (index === -1 || text.indexOf(token, index + token.length) === -1) {
      return;
    }

    if (!bestMatch || index < bestMatch.index || (index === bestMatch.index && token.length > bestMatch.token.length)) {
      bestMatch = { index, token };
    }
  });

  return bestMatch;
}

function applyInlineTokenStyle(baseStyle: InlineStyle, token: string): InlineStyle {
  if (token === "***" || token === "___") {
    return {
      ...baseStyle,
      bold: true,
      italics: true,
    };
  }

  if (token === "**" || token === "__") {
    return {
      ...baseStyle,
      bold: true,
    };
  }

  return {
    ...baseStyle,
    italics: true,
  };
}

function createInlineSegment(text: string, style: InlineStyle): InlineSegment {
  return {
    text,
    style,
  };
}

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

interface InlineSegment {
  text: string;
  style: InlineStyle;
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
