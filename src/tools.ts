import type { ToolCall, ToolDefinition } from "./types.js";

export interface ToolContext {
  signal?: AbortSignal;
}

export interface Tool<Result = unknown> {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<Result> | Result;
}

export interface ToolExecutionResult {
  toolCall: ToolCall;
  ok: boolean;
  result: unknown;
}

/** 按名称注册工具，并在 Agent 循环中统一执行与错误收敛。 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** 注册或覆盖同名工具，支持链式调用。 */
  register(tool: Tool): this {
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  /** 供模型 `tools` 参数使用的全部工具定义（JSON Schema）。 */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  /** 根据 `toolCall.name` 查找工具并执行；异常会转为 `ok: false` 的结果。 */
  async execute(toolCall: ToolCall, context?: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCall,
        ok: false,
        result: `Tool "${toolCall.name}" is not registered.`
      };
    }

    try {
      // 统一在注册表层收敛异常，避免单个工具把整轮 agent 流程打断。
      const result = await tool.execute(toolCall.arguments, context);
      return { toolCall, ok: true, result };
    } catch (error) {
      return {
        toolCall,
        ok: false,
        result: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

/** 内置示例工具：返回当前时间的 ISO 字符串与时间戳。 */
export function createClockTool(): Tool<{ now: string; timestamp: number }> {
  return {
    definition: {
      name: "get_current_time",
      description: "Get the current system time in ISO format.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    // 执行工具
    execute() {
      return {
        now: new Date().toISOString(),
        timestamp: Date.now()
      };
    }
  };
}

/**
 * 内置示例工具：在受限字符集内求值算术表达式（非通用脚本执行）。
 * 通过白名单正则限制输入，降低注入风险。
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
            description: "Arithmetic expression such as (2 + 3) * 4"
          }
        },
        required: ["expression"],
        additionalProperties: false
      }
    },
    execute(args) {
      const expression = String(args.expression ?? "").trim();
      if (!expression) {
        throw new Error("expression is required");
      }

      // 这里只允许基础算术字符，避免执行任意代码。
      if (!/^[\d+\-*/().\s]+$/.test(expression)) {
        throw new Error("expression contains unsupported characters");
      }

      const result = Function(`"use strict"; return (${expression});`)();
      if (typeof result !== "number" || Number.isNaN(result)) {
        throw new Error("expression did not produce a valid number");
      }

      return { expression, result };
    }
  };
}
