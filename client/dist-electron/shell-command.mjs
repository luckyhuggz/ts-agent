import { spawn } from "node:child_process";
import { resolve } from "node:path";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 20_000;
export async function runShellCommand(request) {
    const command = String(request.command ?? "").trim();
    if (!command) {
        throw new Error("command is required.");
    }
    const cwd = resolve(String(request.cwd ?? process.cwd()));
    const timeoutMs = normalizeTimeout(request.timeoutMs);
    const shellSpec = getShellSpec(command);
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(shellSpec.command, shellSpec.args, {
            cwd,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            const next = appendOutput(stdout, chunk);
            stdout = next.value;
            stdoutTruncated = stdoutTruncated || next.truncated;
        });
        child.stderr.on("data", (chunk) => {
            const next = appendOutput(stderr, chunk);
            stderr = next.value;
            stderrTruncated = stderrTruncated || next.truncated;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectPromise(error);
        });
        child.on("close", (exitCode) => {
            clearTimeout(timer);
            resolvePromise({
                command,
                cwd,
                shell: shellSpec.label,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                stdoutTruncated,
                stderrTruncated,
                exitCode,
                timedOut,
                success: !timedOut && exitCode === 0,
            });
        });
    });
}
function getShellSpec(command) {
    if (process.platform === "win32") {
        return {
            command: "powershell.exe",
            args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
            label: "powershell.exe",
        };
    }
    const shell = process.env.SHELL || "/bin/bash";
    return {
        command: shell,
        args: ["-lc", command],
        label: shell,
    };
}
function normalizeTimeout(timeoutMs) {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS);
}
function appendOutput(current, chunk) {
    const remaining = MAX_OUTPUT_CHARS - current.length;
    if (remaining <= 0) {
        return { value: current, truncated: true };
    }
    if (chunk.length <= remaining) {
        return { value: current + chunk, truncated: false };
    }
    return {
        value: current + chunk.slice(0, remaining),
        truncated: true,
    };
}
