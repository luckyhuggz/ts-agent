import type { ToolCall, ToolDefinition } from "./types";
import {
  applyDocumentPatch,
  importSkill,
  listSkills,
  loadSkill,
  readDocumentFile,
  readSkillResource,
  runShellCommand,
  writeDocumentFile,
} from "@/lib/desktop";

/**
 * 工具执行上下文。
 *
 * 当前字段不多，但作为扩展点保留。
 *
 * 潜在调用方：
 * - 目前 `ToolRegistry.execute()` 会把它透传给具体工具。
 * - 未来如果接入取消、中断、权限信息、日志链路，都可以放这里。
 */
export interface ToolContext {
  /** 可选取消信号，目前内置工具未使用，但接口层已预留。 */
  signal?: AbortSignal;
}

/**
 * 单个工具的统一协议。
 *
 * 调用方：
 * - `ToolRegistry.register()` 接收该结构。
 * - `ToolRegistry.execute()` 调用其 `execute()`。
 */
export interface Tool<Result = unknown> {
  /** 工具的元信息，会被发给模型，让模型知道有哪些工具可用。 */
  definition: ToolDefinition;
  /** 工具实际执行逻辑。 */
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<Result> | Result;
}

/**
 * 工具执行结果。
 *
 * 调用方：
 * - `ToolRegistry.execute()` 返回。
 * - `Agent.run()` 接收后会转成 tool message 写回 memory。
 */
export interface ToolExecutionResult {
  /** 原始工具调用请求。 */
  toolCall: ToolCall;
  /** 执行是否成功。 */
  ok: boolean;
  /** 成功时是结果，失败时通常是错误文本。 */
  result: unknown;
}

/**
 * 工具注册表。
 *
 * 核心职责：
 * - 保存“工具名 -> 工具实现”的映射。
 * - 为模型提供工具定义列表。
 * - 按模型返回的工具调用名称执行对应工具。
 *
 * 主要调用方：
 * - `src/App.tsx` 中 `buildAgent()` 负责注册内置工具。
 * - `Agent.run()` 调用 `getDefinitions()` 和 `execute()`。
 */
export class ToolRegistry {
  /** 内部 Map 以工具名作为唯一键。 */
  private readonly tools = new Map<string, Tool>();

  /**
   * 注册一个工具，并返回自身，便于链式调用。
   *
   * 调用方：
   * - `src/App.tsx` 中：
   *   `new ToolRegistry().register(createClockTool()).register(createCalculatorTool())`
   */
  register(tool: Tool): this {
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  /**
   * 获取所有工具定义。
   *
   * 调用方：
   * - `Agent.run()` 在调用模型前，把这些定义发给模型。
   */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  /**
   * 按工具调用请求执行对应工具。
   *
   * 调用方：
   * - `Agent.run()`。
   *
   * 执行逻辑：
   * 1. 根据 `toolCall.name` 查找工具。
   * 2. 若没找到，返回统一失败结果，而不是直接抛错。
   * 3. 找到后调用工具实现。
   * 4. 若工具内部抛异常，这里捕获并转成可序列化错误文本。
   */
  async execute(toolCall: ToolCall, context?: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCall,
        ok: false,
        result: `Tool "${toolCall.name}" is not registered.`,
      };
    }

    if (toolCall.argumentsParseError) {
      return {
        toolCall,
        ok: false,
        result: buildToolArgumentParseError(toolCall),
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments, context);
      return { toolCall, ok: true, result };
    } catch (error) {
      return {
        toolCall,
        ok: false,
        result: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * 创建“获取当前时间”工具。
 *
 * 调用方：
 * - `src/App.tsx` 中 `buildAgent()` 注册该工具。
 *
 * 被谁调用：
 * - 注册后由 `ToolRegistry.execute()` 间接调用其 `execute()`。
 */
export function createClockTool(): Tool<{ now: string; timestamp: number }> {
  return {
    definition: {
      name: "get_current_time",
      description: "Get the current system time in ISO format.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    // 无输入参数，直接返回当前系统时间。
    execute() {
      return {
        now: new Date().toISOString(),
        timestamp: Date.now(),
      };
    },
  };
}

/**
 * 创建“基础算术计算器”工具。
 *
 * 调用方：
 * - `src/App.tsx` 中 `buildAgent()` 注册该工具。
 *
 * 被谁调用：
 * - 注册后由 `ToolRegistry.execute()` 间接调用其 `execute()`。
 *
 * 安全说明：
 * - 这里只允许数字、空格和 `+ - * / ( ) .`。
 * - 在通过正则校验后，才使用 `Function` 求值。
 * - 这不是通用表达式引擎，只覆盖简单算术。
 */
export function createCalculatorTool(): Tool<{ expression: string; result: number }> {
  return {
    definition: {
      name: "calculate",
      description: "Evaluate a basic arithmetic expression with numbers and + - * / ( ).",
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Arithmetic expression such as (2 + 3) * 4",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
    // 模型会把参数对象传进来，这里读取其中的 `expression`。
    execute(args) {
      const expression = String(args.expression ?? "").trim();
      if (!expression) throw new Error("expression is required");
      // 严格限制允许字符，避免执行任意代码。
      if (!/^[\d+\-*/().\s]+$/.test(expression)) {
        throw new Error("expression contains unsupported characters");
      }
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      // 在上面的字符白名单校验通过后，再执行简单算术表达式。
      const result = Function(`"use strict"; return (${expression});`)() as unknown;
      if (typeof result !== "number" || Number.isNaN(result)) {
        throw new Error("expression did not produce a valid number");
      }
      return { expression, result };
    },
  };
}

/**
 * 创建“读取本地文档内容”工具。
 *
 * 调用方：
 * - `src/App.tsx` 中 `buildAgent()` 注册该工具。
 *
 * 被谁调用：
 * - 注册后由 `ToolRegistry.execute()` 间接调用其 `execute()`。
 */
export function createDocumentReadTool(): Tool<{
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
  truncated: boolean;
  charCount: number;
  warnings: string[];
}> {
  return {
    definition: {
      name: "read_document_content",
      description:
        "Read text content from a local .txt, .md, .html, .docx, or .pdf file. Use an absolute file path when possible.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Absolute path to a local document file such as C:\\docs\\report.pdf",
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const filePath = String(args.filePath ?? "").trim();
      if (!filePath) {
        throw new Error("filePath is required");
      }

      const result = await readDocumentFile(filePath);
      return result;
    },
  };
}

/**
 * 创建“写入本地文档内容”工具。
 *
 * 使用方式：
 * - 适合创建新文件，或对较短内容做整文件覆盖。
 * - 对长 HTML / 长文本，不要把整份内容放进工具 JSON 参数；应优先使用系统提示词里定义的 `lucky-file` 文件块协议。
 */
export function createDocumentWriteTool(): Tool<{
  filePath: string;
  fileName: string;
  extension: string;
  charCount: number;
  mode: "overwrite" | "replace_text";
  replacedCount: number;
}> {
  return {
    definition: {
      name: "write_document_content",
      description:
        "Create or overwrite a local .txt, .md, .html, or .docx file with complete content. Use this for short or medium files. For large file creation, prefer apply_patch_document first. Only fall back to lucky-file blocks if patch output is not practical.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Target file path. Relative paths are resolved inside the current workspace.",
          },
          content: {
            type: "string",
            description: "Complete file content to write.",
          },
        },
        required: ["filePath", "content"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const filePath = String(args.filePath ?? "").trim();
      if (!filePath) {
        throw new Error("filePath is required");
      }

      return writeDocumentFile(filePath, {
        content: typeof args.content === "string" ? args.content : String(args.content ?? ""),
      });
    },
  };
}

/**
 * 创建“编辑本地文档内容”工具。
 *
 * 使用方式：
 * - 先通过 `read_document_content` 获取现有内容。
 * - 再用 oldString/newString 做精确替换。
 *
 * 说明：
 * - 对已有文本文件，优先使用局部替换而不是整文件重写。
 * - `docx` 只支持整篇纯文本覆盖，不支持局部替换。
 */
export function createDocumentEditTool(): Tool<{
  filePath: string;
  fileName: string;
  extension: string;
  charCount: number;
  mode: "overwrite" | "replace_text";
  replacedCount: number;
}> {
  return {
    definition: {
      name: "edit_document_content",
      description:
        "Edit an existing local document. For .txt/.md/.html files, use oldString/newString replacement for small targeted edits. For .docx files, only use complete content overwrite. For large edits, prefer apply_patch_document.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Absolute path to a local document file such as C:\\docs\\notes.md",
          },
          content: {
            type: "string",
            description: "Full updated content to overwrite the document. Only use this for .docx or small complete rewrites.",
          },
          oldString: {
            type: "string",
            description: "For .txt/.md/.html only: the exact text segment to replace.",
          },
          newString: {
            type: "string",
            description: "For .txt/.md/.html only: replacement text for oldString.",
          },
          replaceAll: {
            type: "boolean",
            description: "For .txt/.md/.html only: if true, replace every occurrence of oldString.",
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const filePath = String(args.filePath ?? "").trim();
      if (!filePath) {
        throw new Error("filePath is required");
      }

      const result = await writeDocumentFile(filePath, {
        content: typeof args.content === "string" ? args.content : undefined,
        oldString: typeof args.oldString === "string" ? args.oldString : undefined,
        newString: typeof args.newString === "string" ? args.newString : undefined,
        replaceAll: typeof args.replaceAll === "boolean" ? args.replaceAll : undefined,
      });
      return result;
    },
  };
}

export function createDocumentPatchTool(): Tool<{
  applied: number;
  files: Array<{
    filePath: string;
    fileName: string;
    extension: string;
    action: "add" | "update";
    charCount: number;
  }>;
}> {
  return {
    definition: {
      name: "apply_patch_document",
      description:
        "Apply a structured patch to .txt, .md, or .html files. Prefer this for large edits to existing files, or moderate file creation. Supported operations are *** Add File and *** Update File inside a *** Begin Patch / *** End Patch block. If a brand-new file body is very large, prefer lucky-file fallback instead of sending a huge patch JSON payload.",
      inputSchema: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description:
              "Structured patch text. Example: *** Begin Patch\\n*** Add File: demo.html\\n+<html>\\n*** End Patch",
          },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const patch = typeof args.patch === "string" ? args.patch : String(args.patch ?? "");
      if (!patch.trim()) {
        throw new Error("patch is required");
      }

      return applyDocumentPatch(patch);
    },
  };
}

function buildToolArgumentParseError(toolCall: ToolCall): string {
  const baseMessage = `Tool arguments for "${toolCall.name}" could not be parsed. ${toolCall.argumentsParseError}`;

  if (toolCall.name === "apply_patch_document") {
    return [
      baseMessage,
      'Recovery strategy: if you are creating a very large new file, do not send the whole body inside apply_patch_document JSON.',
      'Use <lucky-file path="...">...</lucky-file> blocks for very large whole-file generation.',
      "If you are editing an existing file, retry apply_patch_document with smaller hunks or multiple smaller patch calls.",
    ].join(" ");
  }

  if (toolCall.name === "write_document_content" || toolCall.name === "edit_document_content") {
    return [
      baseMessage,
      "Recovery strategy: for very large whole-file content, avoid large tool JSON payloads.",
      'Use apply_patch_document for large edits, or <lucky-file path="...">...</lucky-file> as a fallback for very large generated files.',
    ].join(" ");
  }

  return baseMessage;
}

/**
 * 创建“执行 shell 命令”工具。
 *
 * 适用场景：
 * - 常见文件移动、复制、重命名
 * - 运行常用脚本命令
 * - 在指定目录执行简单命令并读取输出
 */
export function createShellTool(): Tool<{
  command: string;
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  timedOut: boolean;
  success: boolean;
}> {
  return {
    definition: {
      name: "run_shell_command",
      description:
        "Run a shell command on the local machine. Useful for file move/copy operations and common script commands. On Windows this uses PowerShell; on macOS/Linux it uses the system shell.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to run, such as Copy-Item fileA fileB or npm run build",
          },
          cwd: {
            type: "string",
            description: "Optional working directory for the command.",
          },
          timeoutMs: {
            type: "integer",
            description: "Optional timeout in milliseconds. Defaults to 60000 and is capped internally.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const command = String(args.command ?? "").trim();
      if (!command) {
        throw new Error("command is required");
      }

      const cwd = typeof args.cwd === "string" ? args.cwd.trim() : undefined;
      const timeoutMs =
        typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
          ? Math.floor(args.timeoutMs)
          : undefined;

      return runShellCommand({
        command,
        cwd: cwd || undefined,
        timeoutMs,
      });
    },
  };
}

/**
 * 创建“列出当前工作目录可用 skills”工具。
 */
export function createListSkillsTool(): Tool<Awaited<ReturnType<typeof listSkills>>> {
  return {
    definition: {
      name: "list_skills",
      description:
        "List the skills available in the current workspace. Use this to discover which skills can help with the user's task.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    async execute() {
      return listSkills();
    },
  };
}

/**
 * 创建“加载单个 skill 内容”工具。
 */
export function createLoadSkillTool(): Tool<Awaited<ReturnType<typeof loadSkill>>> {
  return {
    definition: {
      name: "load_skill",
      description:
        "Load a single skill by name and return its full SKILL.md content plus the list of resource files in that skill directory.",
      inputSchema: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: "The skill name from the catalog, such as vercel-deploy",
          },
        },
        required: ["skillName"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const skillName = String(args.skillName ?? "").trim();
      if (!skillName) {
        throw new Error("skillName is required");
      }
      return loadSkill(skillName);
    },
  };
}

/**
 * 创建“读取 skill 资源文件”工具。
 */
export function createReadSkillResourceTool(): Tool<Awaited<ReturnType<typeof readSkillResource>>> {
  return {
    definition: {
      name: "read_skill_resource",
      description:
        "Read a text resource file inside a loaded skill directory, such as references, scripts, templates, or additional markdown instructions.",
      inputSchema: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: "The skill name.",
          },
          relativePath: {
            type: "string",
            description: "Path relative to the skill directory, such as references/guide.md",
          },
        },
        required: ["skillName", "relativePath"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const skillName = String(args.skillName ?? "").trim();
      const relativePath = String(args.relativePath ?? "").trim();
      if (!skillName) {
        throw new Error("skillName is required");
      }
      if (!relativePath) {
        throw new Error("relativePath is required");
      }
      return readSkillResource({ skillName, relativePath });
    },
  };
}

/**
 * 创建“导入外部 skill 到当前工作目录”工具。
 */
export function createImportSkillTool(): Tool<Awaited<ReturnType<typeof importSkill>>> {
  return {
    definition: {
      name: "import_skill",
      description:
        "Import an external skill folder into the current workspace under .agents/skills. The source must contain a SKILL.md file.",
      inputSchema: {
        type: "object",
        properties: {
          sourcePath: {
            type: "string",
            description: "Absolute path to a skill directory or a SKILL.md file to import.",
          },
          replaceExisting: {
            type: "boolean",
            description: "If true, overwrite an existing imported skill with the same directory name.",
          },
        },
        required: ["sourcePath"],
        additionalProperties: false,
      },
    },
    async execute(args) {
      const sourcePath = String(args.sourcePath ?? "").trim();
      if (!sourcePath) {
        throw new Error("sourcePath is required");
      }
      return importSkill({
        sourcePath,
        replaceExisting: typeof args.replaceExisting === "boolean" ? args.replaceExisting : undefined,
      });
    },
  };
}
