import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function assistant(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function streamToolProbe(model: Model<any>, context: Context, _options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const output = assistant(model);
  queueMicrotask(() => {
    stream.push({ type: "start", partial: output });
    const globals = globalThis as typeof globalThis & {
      taumelToolSurfaceProbe?: {
        receivedTools: string[];
        issuedToolCalls: string[];
        completedToolCalls: string[];
        toolResults: string[];
      };
    };
    const probe = globals.taumelToolSurfaceProbe ??= {
      receivedTools: [],
      issuedToolCalls: [],
      completedToolCalls: [],
      toolResults: [],
    };
    probe.receivedTools = context.tools?.map((tool) => tool.name) ?? [];
    if (context.messages.some((message) => message.role === "toolResult")) {
      const result = context.messages.findLast((message) => message.role === "toolResult");
      if (result?.role === "toolResult") {
        probe.toolResults.push(result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"));
      }
      const toolName = probe.issuedToolCalls.at(-1) ?? "unknown";
      probe.completedToolCalls.push(toolName);
      const text = toolName === "ralph_continue"
        ? "TAUMEL_RALPH_CONTINUE_OK"
        : "TAUMEL_CHILD_EXEC_OK";
      output.content.push({ type: "text", text });
      stream.push({ type: "text_start", contentIndex: 0, partial: output });
      stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
      stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
      return;
    }

    const requestedTool = context.tools?.some((tool) => tool.name === "ralph_continue")
      ? "ralph_continue"
      : context.tools?.some((tool) => tool.name === "exec_command")
        ? "exec_command"
        : undefined;
    if (requestedTool !== undefined) {
      const prompt = context.messages
        .filter((message) => message.role === "user")
        .map((message) => typeof message.content === "string"
          ? message.content
          : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"))
        .join("\n");
      const taskId = /ralph_continue with task_id (\S+)/.exec(prompt)?.[1];
      const toolCall = {
        type: "toolCall" as const,
        id: "tool-surface-probe",
        name: requestedTool,
        arguments: requestedTool === "ralph_continue"
          ? { task_id: taskId ?? "missing-task-id" }
          : { cmd: "printf TAUMEL_CHILD_EXEC_OK" },
      };
      probe.issuedToolCalls.push(requestedTool);
      output.content.push(toolCall);
      output.stopReason = "toolUse";
      stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
      stream.push({ type: "done", reason: "toolUse", message: output });
      stream.end();
      return;
    }

    const text = "MISSING_REQUIRED_CHILD_TOOL";
    output.content.push({ type: "text", text });
    stream.push({ type: "text_start", contentIndex: 0, partial: output });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
    stream.push({ type: "done", reason: "stop", message: output });
    stream.end();
  });
  return stream;
}

export default function toolSurfaceProvider(pi: ExtensionAPI) {
  pi.registerProvider("taumel-test", {
    name: "Taumel test provider",
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "test-key",
    api: "taumel-test-api" as any,
    streamSimple: streamToolProbe,
    models: [{
      id: "tool-probe",
      name: "Tool surface probe",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
    }],
  });
}
