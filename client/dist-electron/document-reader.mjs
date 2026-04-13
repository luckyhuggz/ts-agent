import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { resolveWorkspacePath } from "./workspace.mjs";
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm", ".docx", ".pdf"]);
const MAX_CONTENT_CHARS = 20_000;
export async function readDocumentFile(request) {
    const inputPath = String(request.filePath ?? "").trim();
    if (!inputPath) {
        throw new Error("filePath is required.");
    }
    const resolvedPath = resolveWorkspacePath(inputPath);
    const extension = extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported file type "${extension || "unknown"}". Supported: .txt, .md, .html, .docx, .pdf`);
    }
    const { content, warnings } = await extractDocumentContent(resolvedPath, extension);
    const normalizedContent = normalizeDocumentText(content);
    if (!normalizedContent) {
        throw new Error("The document does not contain readable text content.");
    }
    const truncatedContent = normalizedContent.slice(0, MAX_CONTENT_CHARS);
    return {
        filePath: resolvedPath,
        fileName: basename(resolvedPath),
        extension,
        content: truncatedContent,
        truncated: truncatedContent.length < normalizedContent.length,
        charCount: normalizedContent.length,
        warnings,
    };
}
async function extractDocumentContent(filePath, extension) {
    if (extension === ".txt" ||
        extension === ".md" ||
        extension === ".markdown" ||
        extension === ".html" ||
        extension === ".htm") {
        const content = await readFile(filePath, "utf8");
        return { content, warnings: [] };
    }
    if (extension === ".docx") {
        const result = await mammoth.extractRawText({ path: filePath });
        return {
            content: result.value,
            warnings: result.messages.map((message) => `${message.type}: ${message.message}`),
        };
    }
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return { content: result.text, warnings: [] };
    }
    finally {
        await parser.destroy();
    }
}
function normalizeDocumentText(content) {
    return content
        .replace(/\r\n?/g, "\n")
        .replace(/\u0000/g, "")
        .trim();
}
