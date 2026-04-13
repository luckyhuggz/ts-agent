import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { getSkillsDir } from "./workspace.mjs";
const SKILL_FILE_NAME = "SKILL.md";
const MAX_RESOURCE_COUNT = 100;
export async function listSkills() {
    const skillsRoot = getSkillsDir();
    await mkdir(skillsRoot, { recursive: true });
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const skillDir = resolve(skillsRoot, entry.name);
        const skillFilePath = resolve(skillDir, SKILL_FILE_NAME);
        try {
            const markdown = await readFile(skillFilePath, "utf8");
            skills.push(toSkillSummary(skillDir, skillFilePath, markdown));
        }
        catch {
            // Ignore invalid skill folders to keep the catalog resilient.
        }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadSkill(skillName) {
    const match = await findSkillByName(skillName);
    if (!match) {
        throw new Error(`Skill "${skillName}" was not found in the current workspace.`);
    }
    const markdown = await readFile(match.skillFilePath, "utf8");
    const summary = toSkillSummary(match.skillDir, match.skillFilePath, markdown);
    const resources = await listSkillResources(match.skillDir);
    return {
        ...summary,
        content: markdown,
        resources,
    };
}
export async function readSkillResource(skillName, relativePath) {
    const match = await findSkillByName(skillName);
    if (!match) {
        throw new Error(`Skill "${skillName}" was not found in the current workspace.`);
    }
    const normalizedRelativePath = String(relativePath ?? "").trim();
    if (!normalizedRelativePath) {
        throw new Error("relativePath is required.");
    }
    const absolutePath = resolve(match.skillDir, normalizedRelativePath);
    if (!isPathInside(match.skillDir, absolutePath)) {
        throw new Error("relativePath must stay inside the skill directory.");
    }
    const content = await readFile(absolutePath, "utf8");
    return {
        skillName: match.name,
        relativePath: normalizedRelativePath.replaceAll("\\", "/"),
        absolutePath,
        content,
    };
}
export async function importSkill(request) {
    const sourcePath = resolve(String(request.sourcePath ?? "").trim());
    if (!sourcePath) {
        throw new Error("sourcePath is required.");
    }
    const sourceDir = extname(sourcePath).toLowerCase() === ".md" ? dirname(sourcePath) : sourcePath;
    const skillFilePath = resolve(sourceDir, SKILL_FILE_NAME);
    const markdown = await readFile(skillFilePath, "utf8");
    const summary = toSkillSummary(sourceDir, skillFilePath, markdown);
    const skillsRoot = getSkillsDir();
    await mkdir(skillsRoot, { recursive: true });
    const targetDir = resolve(skillsRoot, basename(sourceDir));
    if (request.replaceExisting === true) {
        await rm(targetDir, { recursive: true, force: true });
    }
    await cp(sourceDir, targetDir, {
        recursive: true,
        force: request.replaceExisting === true,
        errorOnExist: request.replaceExisting !== true,
    });
    return {
        imported: true,
        skill: {
            ...summary,
            skillDir: targetDir,
            skillFilePath: resolve(targetDir, SKILL_FILE_NAME),
        },
        targetDir,
    };
}
async function findSkillByName(skillName) {
    const normalized = skillName.trim().toLowerCase();
    if (!normalized)
        return null;
    const skills = await listSkills();
    return (skills.find((skill) => skill.name.toLowerCase() === normalized) ??
        skills.find((skill) => basename(skill.skillDir).toLowerCase() === normalized) ??
        null);
}
function toSkillSummary(skillDir, skillFilePath, markdown) {
    const { metadata, body } = splitFrontmatter(markdown);
    const fallbackName = basename(skillDir);
    const fallbackDescription = firstNonEmptyLine(body) ?? "No description provided.";
    return {
        name: asString(metadata.name) || fallbackName,
        description: asString(metadata.description) || fallbackDescription,
        skillDir,
        skillFilePath,
        version: asString(metadata.version) || undefined,
        whenToUse: asString(metadata.whenToUse) || asString(metadata.when_to_use) || undefined,
        tags: asStringArray(metadata.tags),
    };
}
async function listSkillResources(skillDir) {
    const collected = [];
    await walk(skillDir, skillDir, collected);
    return collected.sort();
}
async function walk(rootDir, currentDir, collected) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
        if (collected.length >= MAX_RESOURCE_COUNT)
            return;
        const absolutePath = resolve(currentDir, entry.name);
        if (entry.isDirectory()) {
            await walk(rootDir, absolutePath, collected);
            continue;
        }
        if (!entry.isFile())
            continue;
        if (entry.name === SKILL_FILE_NAME)
            continue;
        collected.push(relative(rootDir, absolutePath).replaceAll("\\", "/"));
    }
}
function splitFrontmatter(markdown) {
    const normalized = markdown.replace(/\r\n?/g, "\n");
    if (!normalized.startsWith("---\n")) {
        return { metadata: {}, body: normalized.trim() };
    }
    const endIndex = normalized.indexOf("\n---\n", 4);
    if (endIndex === -1) {
        return { metadata: {}, body: normalized.trim() };
    }
    const rawFrontmatter = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 5).trim();
    try {
        const parsed = parseYaml(rawFrontmatter);
        return {
            metadata: isRecord(parsed) ? parsed : {},
            body,
        };
    }
    catch {
        return { metadata: {}, body };
    }
}
function firstNonEmptyLine(text) {
    const line = text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean);
    return line ?? null;
}
function asString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPathInside(baseDir, candidatePath) {
    const normalizedBase = resolve(baseDir);
    const normalizedCandidate = resolve(candidatePath);
    return (normalizedCandidate === normalizedBase ||
        normalizedCandidate.startsWith(`${normalizedBase}\\`) ||
        normalizedCandidate.startsWith(`${normalizedBase}/`));
}
