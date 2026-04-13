import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
let database = null;
export function listChatSessions(workspaceDir) {
    const db = getDatabase();
    const statement = db.prepare(`
    SELECT
      id,
      workspace_dir,
      title,
      preview,
      created_at,
      updated_at,
      last_message_at,
      message_count
    FROM chat_sessions
    WHERE workspace_dir = ?
    ORDER BY datetime(last_message_at) DESC, datetime(updated_at) DESC
  `);
    return statement.all(workspaceDir).map(mapSessionRow);
}
export function createChatSession(request) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const summary = {
        id: randomUUID(),
        workspaceDir: resolve(request.workspaceDir),
        title: normalizeSessionTitle(request.title),
        preview: "",
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        messageCount: 0,
    };
    db.prepare(`
    INSERT INTO chat_sessions (
      id, workspace_dir, title, preview, created_at, updated_at, last_message_at, message_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(summary.id, summary.workspaceDir, summary.title, summary.preview, summary.createdAt, summary.updatedAt, summary.lastMessageAt, summary.messageCount);
    return summary;
}
export function getChatSessionMessages(sessionId) {
    const db = getDatabase();
    const statement = db.prepare(`
    SELECT
      id,
      role,
      content,
      tool_name,
      tool_calls_json,
      created_at,
      sort_order
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY sort_order ASC, datetime(created_at) ASC
  `);
    return statement.all(sessionId).map((row) => ({
        id: String(row.id),
        role: asMessageRole(row.role),
        content: String(row.content ?? ""),
        toolName: asOptionalString(row.tool_name),
        toolCalls: parseToolCalls(row.tool_calls_json),
        createdAt: String(row.created_at),
        sortOrder: Number(row.sort_order ?? 0),
    }));
}
export function saveChatSessionMessages(request) {
    const db = getDatabase();
    const workspaceDir = resolve(request.workspaceDir);
    const existing = getSessionSummaryById(request.sessionId);
    const createdAt = existing?.createdAt ?? new Date().toISOString();
    const summary = buildSessionSummary({
        sessionId: request.sessionId,
        workspaceDir,
        createdAt,
        previousTitle: existing?.title,
        messages: request.messages,
    });
    db.exec("BEGIN IMMEDIATE");
    try {
        db.prepare(`
      INSERT INTO chat_sessions (
        id, workspace_dir, title, preview, created_at, updated_at, last_message_at, message_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_dir = excluded.workspace_dir,
        title = excluded.title,
        preview = excluded.preview,
        updated_at = excluded.updated_at,
        last_message_at = excluded.last_message_at,
        message_count = excluded.message_count
    `).run(summary.id, summary.workspaceDir, summary.title, summary.preview, summary.createdAt, summary.updatedAt, summary.lastMessageAt, summary.messageCount);
        db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(summary.id);
        const insertMessage = db.prepare(`
      INSERT INTO chat_messages (
        id, session_id, role, content, tool_name, tool_calls_json, created_at, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const message of request.messages) {
            insertMessage.run(message.id, summary.id, message.role, message.content, message.toolName ?? null, message.toolCalls?.length ? JSON.stringify(message.toolCalls) : null, message.createdAt, message.sortOrder);
        }
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    return summary;
}
function getSessionSummaryById(sessionId) {
    const db = getDatabase();
    const row = db
        .prepare(`
      SELECT
        id,
        workspace_dir,
        title,
        preview,
        created_at,
        updated_at,
        last_message_at,
        message_count
      FROM chat_sessions
      WHERE id = ?
    `)
        .get(sessionId);
    return row ? mapSessionRow(row) : null;
}
function buildSessionSummary(input) {
    const now = new Date().toISOString();
    const normalizedMessages = [...input.messages].sort((a, b) => a.sortOrder - b.sortOrder);
    const firstUserMessage = normalizedMessages.find((message) => message.role === "user" && message.content.trim());
    const title = firstUserMessage?.content.trim() ||
        (input.previousTitle && input.previousTitle !== "新对话" ? input.previousTitle : "") ||
        "新对话";
    const previewSource = [...normalizedMessages]
        .reverse()
        .find((message) => message.content.trim() || message.toolName)?.content ??
        "";
    const lastMessage = normalizedMessages.at(-1);
    return {
        id: input.sessionId,
        workspaceDir: input.workspaceDir,
        title: truncateText(title, 32),
        preview: truncateText(previewSource.replace(/\s+/g, " ").trim(), 80),
        createdAt: input.createdAt,
        updatedAt: now,
        lastMessageAt: lastMessage?.createdAt ?? now,
        messageCount: normalizedMessages.length,
    };
}
function getDatabase() {
    if (database) {
        return database;
    }
    const databasePath = resolve(join(app.getPath("userData"), "history", "chat-history.sqlite"));
    mkdirSync(dirname(databasePath), { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      title TEXT NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_calls_json TEXT,
      created_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_last_message
      ON chat_sessions(workspace_dir, last_message_at DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_sort
      ON chat_messages(session_id, sort_order ASC);
  `);
    database = db;
    return db;
}
function mapSessionRow(row) {
    return {
        id: String(row.id),
        workspaceDir: String(row.workspace_dir),
        title: String(row.title ?? "新对话"),
        preview: String(row.preview ?? ""),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        lastMessageAt: String(row.last_message_at),
        messageCount: Number(row.message_count ?? 0),
    };
}
function parseToolCalls(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isPersistedToolCall) : undefined;
    }
    catch {
        return undefined;
    }
}
function isPersistedToolCall(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.arguments === "object" &&
        candidate.arguments !== null &&
        !Array.isArray(candidate.arguments));
}
function normalizeSessionTitle(value) {
    const normalized = String(value ?? "").trim();
    return normalized ? truncateText(normalized, 32) : "新对话";
}
function truncateText(value, maxLength) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
function asOptionalString(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function asMessageRole(value) {
    switch (value) {
        case "user":
        case "assistant":
        case "tool":
        case "error":
            return value;
        default:
            return "assistant";
    }
}
