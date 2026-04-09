import type { ToolCall, ToolDefinition } from "./types";

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

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(toolCall: ToolCall, context?: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCall,
        ok: false,
        result: `Tool "${toolCall.name}" is not registered.`,
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
    execute() {
      return {
        now: new Date().toISOString(),
        timestamp: Date.now(),
      };
    },
  };
}

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
    execute(args) {
      const expression = String(args.expression ?? "").trim();
      if (!expression) throw new Error("expression is required");
      if (!/^[\d+\-*/().\s]+$/.test(expression)) {
        throw new Error("expression contains unsupported characters");
      }
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const result = Function(`"use strict"; return (${expression});`)() as unknown;
      if (typeof result !== "number" || Number.isNaN(result)) {
        throw new Error("expression did not produce a valid number");
      }
      return { expression, result };
    },
  };
}
