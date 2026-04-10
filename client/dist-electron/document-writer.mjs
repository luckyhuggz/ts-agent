import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".docx"]);
export async function writeDocumentFile(request) {
    const inputPath = String(request.filePath ?? "").trim();
    if (!inputPath) {
        throw new Error("filePath is required.");
    }
    const resolvedPath = resolve(inputPath);
    const extension = extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported file type "${extension || "unknown"}". Supported: .txt, .md, .docx`);
    }
    await mkdir(dirname(resolvedPath), { recursive: true });
    if (extension === ".docx") {
        if (request.oldString !== undefined || request.newString !== undefined) {
            throw new Error("docx only supports full content overwrite. Use the content field instead of oldString/newString.");
        }
        const content = normalizeContent(String(request.content ?? ""));
        const buffer = await Packer.toBuffer(new Document({
            sections: [
                {
                    children: toDocxParagraphs(content),
                },
            ],
        }));
        await writeFile(resolvedPath, buffer);
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
        await writeFile(resolvedPath, content, "utf8");
        return {
            filePath: resolvedPath,
            fileName: basename(resolvedPath),
            extension,
            charCount: content.length,
            mode: "replace_text",
            replacedCount,
        };
    }
    else {
        const content = normalizeContent(String(request.content ?? ""));
        await writeFile(resolvedPath, content, "utf8");
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
function normalizeContent(content) {
    return content.replace(/\r\n?/g, "\n");
}
function toDocxParagraphs(content) {
    if (!content) {
        return [new Paragraph("")];
    }
    return content.split(/\n{2,}/).map((block) => {
        const lines = block.split("\n");
        const children = [];
        lines.forEach((line, index) => {
            children.push(new TextRun({
                text: line,
                break: index === 0 ? 0 : 1,
            }));
        });
        return new Paragraph({ children });
    });
}
function replaceText(source, oldString, newString, replaceAll) {
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
