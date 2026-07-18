import { toolNames } from "../src/tool-contracts.ts";
import { cronFireMessageRenderer, goalContinuationMessageRenderer, notificationMessageRenderer, renderersForTool, skillMessageRenderer } from "../src/tool-renderer.ts";
import { Box, visibleWidth } from "@earendil-works/pi-tui";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Identity theme: fg returns the value unchanged so assertions can read the
// rendered text directly (the `•` dot carries no inline color marker).
const theme = {
  fg: (_color, value) => value,
  bold: (value) => value,
};

const renderText = (value) => value.render(120).join("\n");
const assertDirectLayout = (value, label) => {
  const lines = value.split("\n");
  assert(lines[0].startsWith("•"), `${label} header dot should start at column 0 before Pi adds its outer margin: ${value}`);
};
const renderInDefaultToolShell = (component, width) => {
  const shell = new Box(1, 1, (value) => value);
  shell.addChild(component);
  return shell.render(width);
};
const longLines = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`).join("\n");
const exaResults = Array.from({ length: 12 }, (_, index) => ({
  title: `Result ${index + 1}`,
  url: `https://example.com/${index + 1}`,
  summary: `Summary ${index + 1}`,
}));
const threadSummaries = Array.from({ length: 12 }, (_, index) => ({
  id: `thread-${index + 1}`,
  title: `Thread ${index + 1}`,
  messageCount: index + 3,
  hits: [
    {
      kind: "message",
      role: "assistant",
      snippet: `renderer hit ${index + 1}`,
      locator: { threadID: `thread-${index + 1}`, entryID: `entry-${index + 1}` },
    },
  ],
}));

function argsFor(name) {
  switch (name) {
    case "exec_command":
      return { cmd: "ls many-files" };
    case "write_stdin":
      return { session_id: 7 };
    case "apply_patch":
      return { input: "*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch" };
    case "write":
    case "edit":
      return { path: "src/example.txt", edits: [{ oldText: "a", newText: "b" }] };
    case "create_goal":
      return { objective: "ship renderer coverage" };
    case "update_goal":
      return { status: "complete" };
    case "query_threads":
      return { query: "renderer" };
    case "read_thread":
      return { threadID: "thread-1" };
    case "agent_spawn":
      return { message: "inspect renderer coverage", description: "Inspect renderer coverage", tier: "medium" };
    case "finder":
      return { query: "inspect renderer coverage", description: "Locate renderer coverage" };
    case "oracle":
      return { message: "inspect renderer coverage", description: "Review renderer coverage" };
    case "agent_send":
      return { agent_id: "worker-1", message: "continue", description: "Continue renderer work" };
    case "agent_wait":
      return { run_ids: ["worker-1-run-1"], timeout_seconds: 0 };
    case "agent_list":
      return {};
    case "agent_close":
      return { agent_id: "worker-1" };
    case "cron_create":
      return { cron: "*/5 * * * *", prompt: "check status", recurring: true };
    case "cron_list":
      return {};
    case "cron_delete":
      return { id: "cron-a" };
    case "ralph_continue":
    case "ralph_finish":
      return { task_id: "task-1" };
    case "web_search_exa":
    case "get_code_context_exa":
    case "exa_agent_create_run":
      return { query: "renderer test" };
    case "crawling_exa":
      return { urls: ["https://example.com"] };
    case "exa_agent_get_run":
    case "exa_agent_cancel_run":
    case "exa_agent_list_events":
      return { id: "run_1" };
    case "exa_agent_list_runs":
      return { limit: 10 };
    default:
      return {};
  }
}

function resultFor(name) {
  if (name === "exec_command" || name === "write_stdin") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, output: longLines, exitCode: 0 } };
  }
  if (name === "write") {
    return { content: [{ type: "text", text: "wrote" }], details: { ok: true, displayPath: "src/example.txt", mode: "overwrite", contents: longLines, byteLength: 42 } };
  }
  if (name === "edit") {
    return { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: "src/example.txt", editCount: 1, before: "line one\nline two\nline three", after: "line one\nline TWO\nline three" } };
  }
  if (name === "apply_patch") {
    return { content: [{ type: "text", text: "Patch applied." }], details: { ok: true, affectedPaths: ["a.txt"], writes: [{ path: "a.txt", before: "alpha\nbeta", contents: "alpha\nBETA\ngamma" }], deletes: [] } };
  }
  if (name === "view_media") {
    return { content: [{ type: "text", text: "Image loaded." }], details: { ok: true, path: "/tmp/pi-clipboard-6e6a501780841a8c.png", mimeType: "image/png", originalWidth: 4096, originalHeight: 1536, width: 2048, height: 768, wasResized: true, payloadBytes: 12345 } };
  }
  if (name === "get_goal" || name === "create_goal" || name === "update_goal") {
    return { content: [{ type: "text", text: "Goal updated." }], details: { ok: true, goal: { objective: "ship renderer coverage", status: "active", tokensUsed: 10, timeUsedSeconds: 2 } } };
  }
  if (name === "query_threads") {
    return { content: [{ type: "text", text: "threads" }], details: { ok: true, threads: threadSummaries } };
  }
  if (name === "read_thread") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, thread: { id: "thread-1", title: "Thread 1" } } };
  }
  if (name === "agent_spawn" || name === "finder" || name === "oracle") {
    const kind = name === "agent_spawn" ? "generic" : name;
    const agentId = name === "agent_spawn" ? "agent-7k2m" : `${kind}-2sk2`;
    return { content: [{ type: "text", text: "agent started" }], details: { ok: true, kind, agentId, runId: `${agentId}-run-1`, tier: name === "agent_spawn" ? "medium" : undefined, model: "provider/model", thinking: kind === "oracle" ? "high" : "low", status: "running" } };
  }
  if (name === "agent_send") {
    return { content: [{ type: "text", text: "agent message sent" }], details: { ok: true, agentId: "worker-1", outcome: "message_sent", runId: "worker-1-run-1", status: "running" } };
  }
  if (name === "agent_wait") {
    return { content: [{ type: "text", text: "done" }], details: { ok: true, results: [{ agent_id: "worker-1", run_id: "worker-1-run-1", kind: "generic", model: "provider/model", thinking: "medium", status: "completed", output: "done", output_available: true }], pending_run_ids: [], timed_out: false } };
  }
  if (name === "agent_list") {
    return { content: [{ type: "text", text: "worker-1" }], details: { ok: true, agents: [{ agent_id: "worker-1", kind: "generic", model: "provider/model", thinking: "medium", workspace: "/workspace", latest_run_id: "worker-1-run-1", latest_run_status: "running" }] } };
  }
  if (name === "agent_close") {
    return { content: [{ type: "text", text: "closed" }], details: { ok: true, agentId: "worker-1", status: "closed" } };
  }
  if (name.startsWith("cron_")) {
    const task = { id: "cron-a", schedule: "every 5 minutes", cron: "*/5 * * * *", prompt: "check status", recurring: true, mode: "message", enabled: true, nextDueText: "soon" };
    if (name === "cron_create") return { content: [{ type: "text", text: "Created cron task cron-a." }], details: { ok: true, task, id: "cron-a", schedule: "*/5 * * * *", recurring: true, mode: "message", enabled: true, nextDueText: "soon" } };
    if (name === "cron_list") return { content: [{ type: "text", text: "Cron tasks listed." }], details: { ok: true, enabled: false, tasks: [task] } };
    return { content: [{ type: "text", text: "Deleted cron task cron-a." }], details: { ok: true, id: "cron-a", deleted: true } };
  }
  if (name === "ralph_continue" || name === "ralph_finish") {
    return { content: [{ type: "text", text: `${name} accepted` }], details: { ok: true, taskId: "task-1", iteration: 2, status: "running", reflection: false } };
  }
  if (name === "web_search_exa" || name === "crawling_exa") {
    return { content: [{ type: "text", text: "exa results" }], details: { ok: true, response: { results: exaResults } } };
  }
  if (name === "get_code_context_exa") {
    return { content: [{ type: "text", text: longLines }], details: { ok: true, response: { response: longLines } } };
  }
  if (name === "exa_agent_list_runs" || name === "exa_agent_list_events") {
    return { content: [{ type: "text", text: "agent list" }], details: { ok: true, response: { data: exaResults.map((item, index) => ({ ...item, id: `run_${index + 1}`, status: "completed" })) } } };
  }
  return { content: [{ type: "text", text: "agent run" }], details: { ok: true, response: { id: "run_1", status: "completed", output: { text: longLines } } } };
}

// Structural invariants for every tool: yellow-dot in-flight call header, and a
// `• name · …` green/red-dot result header in both collapsed and expanded form.
for (const name of toolNames) {
  const renderers = renderersForTool(name);
  assert(typeof renderers.renderCall === "function", `${name} missing renderCall`);
  assert(typeof renderers.renderResult === "function", `${name} missing renderResult`);

  const args = argsFor(name);
  const call = renderText(renderers.renderCall(args, theme, { isPartial: true }));
  assertDirectLayout(call, `${name} call`);
  assert(call.startsWith("•"), `${name} call header should start with the • dot before Pi adds its outer margin: ${call}`);
  assert(call.includes(name), `${name} call header should name the tool: ${call}`);
  assert(/\(running\)|\(searching threads\)|\(reading thread\)|\(reading\)|\(viewing image\)|\(waiting\)|\(waiting for Exa\)|\(starting agent\)|\(waiting for agents\)/.test(call), `${name} call header should carry a dim progress suffix: ${call}`);

  const result = resultFor(name);
  const compact = renderText(renderers.renderResult(result, { expanded: false, isPartial: false }, theme, { args }));
  const expanded = renderText(renderers.renderResult(result, { expanded: true, isPartial: false }, theme, { args }));
  assertDirectLayout(compact, `${name} compact result`);
  assertDirectLayout(expanded, `${name} expanded result`);
  assert(compact.startsWith("•"), `${name} compact header should start with the • dot before Pi adds its outer margin: ${compact}`);
  assert(compact.includes(name), `${name} compact header should name the tool: ${compact}`);
  assert(expanded.length >= compact.length, `${name} expanded renderer should be at least as informative`);
}

// exec_command / write_stdin — in-flight header and tail-oriented body.
assert(
  /• exec_command · ls many-files \(running\)/.test(renderText(renderersForTool("exec_command").renderCall({ cmd: "ls many-files" }, theme, { isPartial: true }))),
  "exec_command call should be `• exec_command · <cmd> (running)` with no $ prefix",
);
assert(
  /• write_stdin · poll session 7 \(running\)/.test(renderText(renderersForTool("write_stdin").renderCall({ session_id: 7 }, theme, { isPartial: true }))),
  "write_stdin poll call should be `• write_stdin · poll session N (running)`",
);
assert(
  renderersForTool("exec_command").renderCall({ cmd: "ls" }, theme, { isPartial: false }).render(120).length === 0,
  "completed exec_command call placeholder should render zero lines, not a blank top-margin row",
);
assert(
  renderersForTool("write_stdin").renderCall({ session_id: 7 }, theme, { isPartial: false }).render(120).length === 0,
  "completed write_stdin call placeholder should render zero lines, not a blank top-margin row",
);
for (const name of ["agent_spawn", "finder", "oracle", "agent_send", "agent_wait", "agent_list", "agent_close"]) {
  assert(
    renderersForTool(name).renderCall(argsFor(name), theme, { isPartial: false }).render(120).length === 0,
    `completed ${name} call placeholder should leave exactly one visible tool slot`,
  );
}

// agent-rn07: Pi retains the component returned for the pending call and stacks
// the result component beneath it. Settling must therefore hide the original
// component, not merely return an empty component from a later renderCall call.
{
  const renderers = renderersForTool("agent_close");
  const state = {};
  const args = { agent_id: "agent-zmrk" };
  const call = renderers.renderCall(args, theme, { args, state, isPartial: true });
  const result = renderers.renderResult(
    { content: [{ type: "text", text: "closed" }], details: { ok: true, agent_id: "agent-zmrk", status: "closed" } },
    { expanded: false, isPartial: false },
    theme,
    { args, state, isPartial: false, isError: false },
  );
  const stacked = [...call.render(120), ...result.render(120)].join("\n");
  assert((stacked.match(/•/g) ?? []).length === 1, `settled agent_close must occupy one visible tool slot: ${stacked}`);
  assert(/^• agent_close · agent-zmrk · closed$/.test(stacked), `agent_close compact slot wrong: ${stacked}`);
  const expanded = renderText(renderers.renderResult(
    { content: [{ type: "text", text: "closed" }], details: { ok: true, agent_id: "agent-zmrk", status: "closed" } },
    { expanded: true, isPartial: false },
    theme,
    { args },
  ));
  assert(expanded.includes("Agent: agent-zmrk"), `expanded agent_close must identify the agent: ${expanded}`);
  assert(expanded.includes("Status: closed"), `expanded agent_close must show closed status: ${expanded}`);
  assert(expanded.includes("Permanent closure: confirmed"), `expanded agent_close must confirm permanent closure: ${expanded}`);
  assert(!expanded.includes("Kind: generic"), `expanded agent_close must not invent a generic kind: ${expanded}`);
}

const spawnedAgent = renderText(renderersForTool("agent_spawn").renderResult(
  resultFor("agent_spawn"),
  { expanded: false, isPartial: false },
  theme,
  { args: argsFor("agent_spawn") },
));
// agentui-weo6: generic spawn compact presentation includes the selected tier.
assert(/^• agent_spawn · agent-7k2m · medium · Inspect renderer coverage$/.test(spawnedAgent), `generic spawn compact slot wrong: ${spawnedAgent}`);
const expandedSpawnedAgent = renderText(renderersForTool("agent_spawn").renderResult(
  resultFor("agent_spawn"),
  { expanded: true, isPartial: false },
  theme,
  { args: argsFor("agent_spawn") },
));
for (const expected of [
  "Agent: agent-7k2m",
  "Run: agent-7k2m-run-1",
  "Kind: generic",
  "Model: provider/model",
  "Thinking: low",
  "Status: running",
  "Description: Inspect renderer coverage",
  "Message: inspect renderer coverage",
]) {
  assert(expandedSpawnedAgent.includes(expected), `expanded agent_spawn missing ${expected}: ${expandedSpawnedAgent}`);
}
const spawnedFinder = renderText(renderersForTool("finder").renderResult(
  resultFor("finder"),
  { expanded: false, isPartial: false },
  theme,
  { args: argsFor("finder") },
));
// agentui-s0qm: compact Finder uses the handle and task description.
assert(/^• finder · finder-2sk2 · Locate renderer coverage$/.test(spawnedFinder), `finder compact slot wrong: ${spawnedFinder}`);
const sentAgent = renderText(renderersForTool("agent_send").renderResult(
  resultFor("agent_send"),
  { expanded: false, isPartial: false },
  theme,
  { args: argsFor("agent_send") },
));
// agentui-u65i: accepted sends omit the redundant running label.
assert(/^• agent_send · worker-1 · Continue renderer work$/.test(sentAgent), `agent_send compact slot wrong: ${sentAgent}`);
// agent-rn15: expanded wait rendering includes routing only on the user-facing surface.
const expandedWait = renderText(renderersForTool("agent_wait").renderResult(
  resultFor("agent_wait"),
  { expanded: true, isPartial: false },
  theme,
  { args: argsFor("agent_wait") },
));
for (const expected of [
  "Agent: worker-1",
  "Run: worker-1-run-1",
  "Kind: generic",
  "Model: provider/model",
  "Thinking: medium",
  "Status: completed",
  "Response: done",
]) {
  assert(expandedWait.includes(expected), `expanded agent_wait missing ${expected}: ${expandedWait}`);
}
const compactWait = renderText(renderersForTool("agent_wait").renderResult(
  resultFor("agent_wait"),
  { expanded: false, isPartial: false },
  theme,
  { args: argsFor("agent_wait") },
));
// agentui-hdst: compact wait preserves ready and pending counts.
assert(/^• agent_wait · 1 ready · 0 pending$/.test(compactWait), `agent_wait compact slot wrong: ${compactWait}`);

const longAgentText = "first agent presentation words must remain visible through the middle and finish with final words";
const wrappedFinder = renderersForTool("finder").renderResult(
  resultFor("finder"),
  { expanded: true, isPartial: false },
  theme,
  { args: { query: longAgentText, description: "Locate renderer coverage" } },
).render(40).join("\n");
const wrappedWait = renderersForTool("agent_wait").renderResult(
  { ...resultFor("agent_wait"), details: { ...resultFor("agent_wait").details, results: [{ ...resultFor("agent_wait").details.results[0], output: longAgentText }] } },
  { expanded: true, isPartial: false },
  theme,
  { args: argsFor("agent_wait") },
).render(40).join("\n");
// agentui-kjx2: expanded instructions and responses wrap without truncation.
for (const [label, rendered] of [["Finder query", wrappedFinder], ["agent_wait response", wrappedWait]]) {
  assert(rendered.replace(/\s+/g, " ").includes(longAgentText) && !rendered.includes("…"), `${label} was not fully wrapped: ${rendered}`);
}

const shell = renderersForTool("exec_command");
const shellArgs = argsFor("exec_command");
const compactShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: false, isPartial: false }, theme, { args: shellArgs }));
const expandedShell = renderText(shell.renderResult(resultFor("exec_command"), { expanded: true, isPartial: false }, theme, { args: shellArgs }));
assert(compactShell.startsWith("• exec_command · ls many-files"), `exec compact header wrong: ${compactShell}`);
assert(compactShell.includes("  └ "), `exec compact body should use the └ connector: ${compactShell}`);
assert(compactShell.includes("… 19 more lines"), `exec tail body should show … N more lines at the top: ${compactShell}`);
assert(!/(^|\n)\s*line-1\s*(\n|$)/.test(compactShell), `exec tail body should clip the head: ${compactShell}`);
assert(/(^|\n)\s*line-24\s*(\n|$)/.test(compactShell), `exec tail body should keep the tail: ${compactShell}`);
assert(/(^|\n).*line-24\b/.test(expandedShell), `exec expanded body should include earlier output: ${expandedShell}`);

// Failed exec → red dot, no exit code repeated in the subject.
const failedShell = renderText(shell.renderResult({ content: [], details: { ok: false, output: "boom", exitCode: 2 } }, { expanded: false, isPartial: false }, theme, { args: shellArgs }));
assert(failedShell.startsWith("• exec_command · ls many-files"), `failed exec header should keep the command subject: ${failedShell}`);
assert(!/exit 2/.test(failedShell), `failed exec should not repeat the exit code in the subject (red dot signals it): ${failedShell}`);

// Running async session → yellow dot + `(session N)` in the subject, no body.
const runningSession = renderText(shell.renderResult({ content: [], details: { ok: true, sessionId: 4 } }, { expanded: false, isPartial: false }, theme, { args: shellArgs }));
assert(/• exec_command · ls many-files \(session 4\)/.test(runningSession) && !runningSession.includes("\n"), `running session should be a yellow-dot header with (session N) and no body: ${runningSession}`);

const statusWaitCompact = renderText(renderersForTool("write_stdin").renderResult(
  { content: [{ type: "text", text: "Session 7 still running; suppressed 42 lines / 8192 bytes" }], details: { ok: true, sessionId: 7, outputMode: "status", suppressedLines: 42, suppressedBytes: 8192 } },
  { expanded: false, isPartial: false },
  theme,
  { args: { session_id: 7, chars: "", output_mode: "status" } },
));
assert(/• write_stdin · wait session 7 \(running; suppressed 42 lines \/ 8192 bytes\)/.test(statusWaitCompact) && !statusWaitCompact.includes("\n"), `status-only wait should be one line without process output: ${statusWaitCompact}`);

// Load-bearing trailing state survives clipping of a long command subject.
const longRunningCommand = "npm --prefix packages/agent run build && npm --prefix packages/coding-agent run build && npm --prefix packages/orchestrator run build";
const narrowRunningSession = renderersForTool("exec_command").renderResult(
  { content: [], details: { ok: true, sessionId: 10 } },
  { expanded: false, isPartial: false },
  theme,
  { args: { cmd: longRunningCommand } },
).render(80)[0];
assert(narrowRunningSession.includes("…") && narrowRunningSession.includes("(session 10)"), `long running command must retain its session state when clipped: ${narrowRunningSession}`);

// Control input remains meaningful, and Pi's isError context drives the state
// dot even when a rejected tool result has no structured details.
const errorDotTheme = {
  ...theme,
  fg: (color, value) => color === "error" ? `<error>${value}</error>` : value,
};
const failedCtrlC = renderText(renderersForTool("write_stdin").renderResult(
  { content: [{ type: "text", text: "session 3 already completed; cannot write stdin" }], details: {} },
  { expanded: false, isPartial: false },
  errorDotTheme,
  { args: { session_id: 3, chars: "\u0003" }, isError: true },
));
assert(failedCtrlC.includes("write_stdin · ^C"), `write_stdin should render Ctrl-C as ^C: ${failedCtrlC}`);
assert(failedCtrlC.startsWith("<error>•</error>"), `failed write_stdin should render a red dot from context.isError: ${failedCtrlC}`);

// Width-aware layout: a long command must clip to ONE physical header line when
// collapsed (the original wrapping nitpick), and wrap under the subject-start
// indent when expanded. Body lines clip (collapsed) / wrap (expanded) to width.
{
  const longCmd = 'cd /home/ribelo/projects/ribelo/taumel && git status --short && echo "=== recent log ===" && git log --oneline -8';
  const longTail = Array.from({ length: 12 }, (_, index) => `cf4af${index} Harden subagent notification delivery ${index}`).join("\n");
  const longRes = { content: [], details: { ok: true, output: longTail, exitCode: 0 } };
  for (const width of [64, 80, 120]) {
    const collapsed = renderersForTool("exec_command").renderResult(longRes, { expanded: false, isPartial: false }, theme, { args: { cmd: longCmd } }).render(width);
    assert(collapsed.length > 1 && visibleWidth(collapsed[0]) <= width && collapsed[0].includes("…"), `collapsed exec header must be one line clipped to width ${width}: ${JSON.stringify(collapsed[0])}`);
    assert(collapsed[1].startsWith("  └ "), `collapsed exec body must start with the semantic └ rail: ${JSON.stringify(collapsed[1])}`);
    const expanded = renderersForTool("exec_command").renderResult(longRes, { expanded: true, isPartial: false }, theme, { args: { cmd: longCmd } }).render(width);
    // Expanded header wraps the full command across several lines, continuation
    // indented to the subject-start column, before the body rail.
    const subjectStart = visibleWidth(`• exec_command · `);
    const contIndent = expanded[1].match(/^ +/)?.[0].length ?? -1;
    assert(expanded.length > 3 && contIndent === subjectStart, `expanded exec header must wrap under the subject-start indent (${subjectStart}), got ${contIndent}: ${JSON.stringify(expanded.slice(0, 2))}`);
    assert(expanded[expanded.length - 1].startsWith("    "), `expanded exec body continuation must use the 4-space semantic rail indent`);
  }
}

// ANSI clipping must not reset the background supplied by Pi's default tool
// shell. Otherwise the ellipsis and trailing facts expose terminal background.
{
  const ansiTheme = {
    fg: (_color, value) => `\x1b[38;5;250m${value}\x1b[39m`,
    bold: (value) => value,
  };
  const shellBackground = (value) => `\x1b[48;5;236m${value}\x1b[49m`;
  const cases = [
    {
      name: "exec_command",
      result: { content: [], details: { ok: true, output: "80 open\n7000 open", exitCode: 0 } },
      args: { cmd: "command -v nmap >/dev/null && nmap -Pn -T4 --top-ports 100 192.0.2.1" },
    },
    {
      name: "web_search_exa",
      result: { content: [], details: { ok: true, response: { results: [] } } },
      args: { query: "PipeWire KEF LSX II Bluetooth AAC first connection failure" },
    },
  ];
  for (const { name, result, args } of cases) {
    const component = renderersForTool(name).renderResult(result, { expanded: false, isPartial: false }, ansiTheme, { args });
    const shell = new Box(1, 1, shellBackground);
    shell.addChild(component);
    const header = shell.render(80)[1];
    let backgroundActive = false;
    for (const segment of header.matchAll(/\x1b\[([0-9;]*)m|([^\x1b])/g)) {
      if (segment[1] !== undefined) {
        for (const code of (segment[1] || "0").split(";").map(Number)) {
          if (code === 0 || code === 49) backgroundActive = false;
          if (code === 48) backgroundActive = true;
        }
      } else if (segment[2] !== undefined) {
        assert(backgroundActive, `${name} reset the default tool shell background before ${JSON.stringify(segment[2])}: ${JSON.stringify(header)}`);
      }
    }
  }
  const shellLines = renderInDefaultToolShell(
    renderersForTool("exec_command").renderResult(resultFor("exec_command"), { expanded: false, isPartial: false }, theme, { args: argsFor("exec_command") }),
    40,
  );
  const shellContentLine = shellLines.find((line) => line.includes("exec_command")) ?? "";
  assert(shellContentLine.startsWith(" • exec_command"), `Pi's outer shell should provide exactly one margin: ${JSON.stringify(shellLines)}`);
  assert(!shellContentLine.startsWith("  •"), `Taumel must not add a second outer margin: ${JSON.stringify(shellLines)}`);
}

// Literal tabs expand to terminal tab stops, not Pi TUI's fixed logical width.
// Normalize them so tab-indented source matches from `rg` do not overflow the
// physical terminal width.
{
  const physicalTerminalWidth = (line, tabStop = 8) => {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    let width = 0;
    for (const char of plain) {
      width += char === "\t" ? tabStop - (width % tabStop) : visibleWidth(char);
    }
    return width;
  };
  const tabbedOutput = [
    "packages/coding-agent/src/core/messages.ts:11:export const COMPACTION_SUMMARY_PREFIX = `...",
    'packages/coding-agent/src/core/agent-session.ts:1757:\t\t\t\t\tthrow new Error("Already compacted");',
    "packages/coding-agent/src/core/agent-session.ts:3020:\t\t\t* history that was compacted away",
  ].join("\n");
  const tabbedResult = { content: [], details: { ok: true, output: tabbedOutput, exitCode: 0 } };
  const tabbedArgs = { cmd: 'rg -n -i "compact(ed)? view|compacted" packages/coding-agent' };
  for (const width of [80, 120]) {
    const lines = renderersForTool("exec_command").renderResult(tabbedResult, { expanded: false, isPartial: false }, theme, { args: tabbedArgs }).render(width);
    const overflow = lines
      .map((line, index) => ({ index, width: physicalTerminalWidth(line), line }))
      .filter((line) => line.width >= width);
    assert(overflow.length === 0, `tabbed exec output reached the physical terminal edge at width ${width}: ${JSON.stringify(overflow[0])}`);
  }
}

// write — content head + `(N lines)`.
const writeCompact = renderText(renderersForTool("write").renderResult(resultFor("write"), { expanded: false, isPartial: false }, theme, { args: argsFor("write") }));
assert(/• write · src\/example\.txt \(24 lines\)/.test(writeCompact), `write subject should be path (N lines): ${writeCompact}`);
assert(writeCompact.includes("  └ "), `write compact should preview the content head via └: ${writeCompact}`);

// edit — Codex-parity unified diff with line-number gutter and +/- markers.
const editCompact = renderText(renderersForTool("edit").renderResult(resultFor("edit"), { expanded: false, isPartial: false }, theme, { args: argsFor("edit") }));
const editExpanded = renderText(renderersForTool("edit").renderResult(resultFor("edit"), { expanded: true, isPartial: false }, theme, { args: argsFor("edit") }));
assert(/• edit · src\/example\.txt \(\+1 -1\)/.test(editCompact), `edit subject should carry (+N -M): ${editCompact}`);
assert(editCompact.includes("- line two"), `edit diff should show a removed (-) line: ${editCompact}`);
assert(editCompact.includes("+ line TWO"), `edit diff should show an added (+) line: ${editCompact}`);
assert(editExpanded.length >= editCompact.length, `edit expanded should be at least as informative`);
assert(!editCompact.includes("  └ "), `edit body should use the line-number gutter, not the └ connector`);
const diffTheme = { fg: (color, value) => color === "toolDiffAdded" ? `<add>${value}</add>` : color === "toolDiffRemoved" ? `<del>${value}</del>` : value };
const coloredEdit = renderText(renderersForTool("edit").renderResult(resultFor("edit"), { expanded: false, isPartial: false }, diffTheme, { args: argsFor("edit") }));
assert(coloredEdit.includes("<add>line TWO</add>") && coloredEdit.includes("<del>line two</del>"), `edit diff should color the whole changed content line: ${coloredEdit}`);

// Pure addition → 5 diff-body rows (2 context + 1 added + 2 context), excluding the header row.
const addEditResult = {
  content: [{ type: "text", text: "edited" }],
  details: { ok: true, displayPath: "src/mid.ts", before: "a\nb\nc\nd\ne", after: "a\nb\nNEW\nc\nd\ne" },
};
const addEditCompact = renderText(renderersForTool("edit").renderResult(addEditResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/mid.ts" } }));
const addEditDiffLines = addEditCompact.split("\n").filter((line) => /^\s+\d+\s+[+\- ]/.test(line));
assert(addEditDiffLines.length === 5, `pure addition should render 5 diff-body rows (2 context + 1 added + 2 context), excluding the header row: ${addEditCompact}`);
assert(/• edit · src\/mid\.ts \(\+1 -0\)/.test(addEditCompact), `addition edit subject should be (+1 -0): ${addEditCompact}`);

// Single-line replacement (the common case) → 6 diff-body rows (2 context + 1 removed + 1 added + 2 context),
// because unified diff shows the old and new lines as separate rows.
const replaceEditResult = {
  content: [{ type: "text", text: "edited" }],
  details: { ok: true, displayPath: "src/mid.ts", before: "a\nb\nOLD\nc\nd\ne", after: "a\nb\nNEW\nc\nd\ne" },
};
const replaceEditCompact = renderText(renderersForTool("edit").renderResult(replaceEditResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/mid.ts" } }));
const replaceEditDiffLines = replaceEditCompact.split("\n").filter((line) => /^\s+\d+\s+[+\- ]/.test(line));
assert(replaceEditDiffLines.length === 6, `single-line replacement should render 6 diff-body rows (2 context + 1 removed + 1 added + 2 context): ${replaceEditCompact}`);
assert(/• edit · src\/mid\.ts \(\+1 -1\)/.test(replaceEditCompact), `replacement edit subject should be (+1 -1): ${replaceEditCompact}`);
assert(replaceEditCompact.includes("- OLD"), `replacement edit should show the removed (-) line: ${replaceEditCompact}`);
assert(replaceEditCompact.includes("+ NEW"), `replacement edit should show the added (+) line: ${replaceEditCompact}`);

// apply_patch — single-file collapsed renders like edit (inline diff); expanded full diff.
const patchCompact = renderText(renderersForTool("apply_patch").renderResult(resultFor("apply_patch"), { expanded: false, isPartial: false }, theme, { args: argsFor("apply_patch") }));
const patchExpanded = renderText(renderersForTool("apply_patch").renderResult(resultFor("apply_patch"), { expanded: true, isPartial: false }, theme, { args: argsFor("apply_patch") }));
assert(/• apply_patch · a\.txt \(\+2 -1\)/.test(patchCompact), `apply_patch single-file subject should be the path (+A -R): ${patchCompact}`);
assert(patchCompact.includes("- beta"), `apply_patch collapsed should show the removed line: ${patchCompact}`);
assert(patchCompact.includes("+ BETA"), `apply_patch collapsed should show the added line: ${patchCompact}`);
assert(!patchCompact.includes("  └ "), `apply_patch single-file body should use the line-number gutter, not the └ connector: ${patchCompact}`);
assert(patchExpanded.includes("+ BETA") && patchExpanded.includes("- beta"), `apply_patch expanded should render the full diff: ${patchExpanded}`);
const failedPatchResult = { content: [{ type: "text", text: "Patch failed: expected context not found\nat line 3" }], details: { ok: false, error: "expected context not found" } };
const failedPatchCompact = renderText(renderersForTool("apply_patch").renderResult(failedPatchResult, { expanded: false, isPartial: false }, theme, { args: argsFor("apply_patch") }));
const failedPatchExpanded = renderText(renderersForTool("apply_patch").renderResult(failedPatchResult, { expanded: true, isPartial: false }, theme, { args: argsFor("apply_patch") }));
assert(failedPatchCompact.includes("Patch failed: expected context not found"), `failed apply_patch compact should show error reason: ${failedPatchCompact}`);
assert(failedPatchExpanded.includes("at line 3"), `failed apply_patch expanded should show full error text: ${failedPatchExpanded}`);

// Mutation renderers must fit inside Pi's default tool shell. If an extension
// renderer returns a line wider than the child width Pi gave it, the terminal
// physically wraps and footer/status rows can paint inside the tool output.
{
  const mutationPath = "/home/ribelo/projects/shareablee/csai/airflow/src/core/airflow-client.ts";
  const mutationBefore = [
    "        // authenticated dispatch so anonymous probes track v2<->v3 deploy flips",
    "        // without a sqlite read per call.",
    "        const cachedAnonymousApiVersions = yield* Ref.make<",
    "            ReadonlyMap<string, AirflowSession[\"apiVersion\"]>",
    "        >(new Map());",
    "        const detectedAnonymousApiVersions = yield* Ref.make<ReadonlySet<string>>(new Set());",
  ].join("\n");
  const mutationAfter = mutationBefore.replace(
    "        >(new Map());",
    "        >(new Map([[\"very-long-airflow-host-name-that-forces-the-line-to-hit-the-terminal-edge.example.com\", \"v3\"]]));",
  );
  const mutationCases = [
    {
      name: "edit",
      result: { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: mutationPath, before: mutationBefore, after: mutationAfter } },
      args: { path: mutationPath },
    },
    {
      name: "write",
      result: { content: [{ type: "text", text: "wrote" }], details: { ok: true, displayPath: mutationPath, contents: mutationAfter } },
      args: { path: mutationPath },
    },
    {
      name: "apply_patch",
      result: { content: [{ type: "text", text: "patched" }], details: { ok: true, writes: [{ path: mutationPath, before: mutationBefore, contents: mutationAfter }] } },
      args: { input: "*** Begin Patch\n*** Update File: src/core/airflow-client.ts\n*** End Patch" },
    },
  ];
  for (const { name, result, args } of mutationCases) {
    for (const expanded of [false, true]) {
      for (const width of [32, 40, 60, 80, 120]) {
        const component = renderersForTool(name).renderResult(result, { expanded, isPartial: false }, theme, { args });
        const lines = renderInDefaultToolShell(component, width);
        const overflow = lines
          .map((line, index) => ({ index, width: visibleWidth(line), line }))
          .filter((line) => line.width > width);
        assert(
          overflow.length === 0,
          `${name} renderer overflowed Pi default shell at width ${width}, expanded=${expanded}: ${JSON.stringify(overflow[0])}`,
        );
      }
    }
  }
}

// read — collapsed is a single header line; expanded shows the body head-oriented (render-rd01).
const readResult = {
  content: [{ type: "text", text: "1\talpha\n2\tbeta\n3\tgamma" }],
  details: { ok: true, path: "src/x.ts", totalLines: 3, startLine: 1, shownLines: 3, truncated: false },
};
const readRenderer = renderersForTool("read");
const compactRead = renderText(readRenderer.renderResult(readResult, { expanded: false, isPartial: false }, theme, { args: { path: "src/x.ts" } }));
const expandedRead = renderText(readRenderer.renderResult(readResult, { expanded: true, isPartial: false }, theme, { args: { path: "src/x.ts" } }));
assert(/• read · src\/x\.ts \(3 lines\)/.test(compactRead) && !compactRead.includes("\n"), `read collapsed should be a single header line: ${compactRead}`);
assert(expandedRead.includes("alpha") && expandedRead.includes("gamma") && expandedRead.length > compactRead.length, `read expanded should show the body: ${expandedRead}`);
// Truncated read → compact shows the returned range, expanded preserves the returned text exactly.
const truncatedRead = renderText(readRenderer.renderResult(
  { content: [{ type: "text", text: "1\talpha\n2\tbeta\n\n[8 more lines in file. Use offset=3 to continue.]" }], details: { ok: true, path: "big.ts", totalLines: 10, startLine: 1, shownLines: 2 } },
  { expanded: true, isPartial: false }, theme, { args: { path: "big.ts" } },
));
assert(truncatedRead.includes("(lines 1–2 of 10)"), `truncated read should show the returned line range: ${truncatedRead}`);
assert(truncatedRead.includes("[8 more lines in file. Use offset=3 to continue.]"), `truncated read should preserve the returned footer exactly: ${truncatedRead}`);
const largeRead = renderText(readRenderer.renderResult(
  { content: [{ type: "text", text: "1\talpha" }], details: { ok: true, path: "big.ts", totalLines: 2898, startLine: 1, shownLines: 1230 } },
  { expanded: false, isPartial: false }, theme, { args: { path: "big.ts" } },
));
assert(largeRead.includes("(lines 1–1230 of 2898)"), `large read should show its actual returned line range: ${largeRead}`);

const mediaCompact = renderText(renderersForTool("view_media").renderResult(resultFor("view_media"), { expanded: false, isPartial: false }, theme, { args: { path: "/tmp/pi-clipboard-6e6a501780841a8c.png" } }));
const mediaExpanded = renderText(renderersForTool("view_media").renderResult(resultFor("view_media"), { expanded: true, isPartial: false }, theme, { args: { path: "/tmp/pi-clipboard-6e6a501780841a8c.png" } }));
assert(/• view_media · \/tmp\/pi-clipboard-6e6a501780841a8c\.png \(4096x1536 -> 2048x768\)/.test(mediaCompact), `view_media compact should show path and resize dimensions: ${mediaCompact}`);
assert(mediaExpanded.includes("Type: image/png") && mediaExpanded.includes("Payload: 12345 bytes") && !mediaExpanded.includes("base64"), `view_media expanded should show metadata but no base64: ${mediaExpanded}`);
const narrowMedia = renderersForTool("view_media").renderResult(resultFor("view_media"), { expanded: false, isPartial: false }, theme, { args: { path: "/tmp/pi-clipboard-6e6a501780841a8c.png" } }).render(60)[0];
assert(narrowMedia.includes("/tmp/") && narrowMedia.includes(".png") && narrowMedia.includes("…"), `compact long media paths should middle-truncate and preserve suffix: ${narrowMedia}`);

// Thread query — compact one-line count; expanded hit snippets.
const queryCompact = renderText(renderersForTool("query_threads").renderResult(resultFor("query_threads"), { expanded: false, isPartial: false }, theme, { args: argsFor("query_threads") }));
const queryExpanded = renderText(renderersForTool("query_threads").renderResult(resultFor("query_threads"), { expanded: true, isPartial: false }, theme, { args: argsFor("query_threads") }));
assert(/• query_threads · "renderer" \(12 threads, 12 hits\)/.test(queryCompact), `query_threads subject should be "query" (N threads, M hits): ${queryCompact}`);
assert(!queryCompact.includes("\n") && !queryCompact.includes("Thread 1"), `query_threads compact should be one line with no item rows: ${queryCompact}`);
assert(queryExpanded.includes("Thread 4") && queryExpanded.includes("message/assistant: renderer hit 1"), `query_threads expanded should include more threads and hit snippets: ${queryExpanded}`);

// Single-entity — header + dim facts line.
const goalCompact = renderText(renderersForTool("create_goal").renderResult(resultFor("create_goal"), { expanded: false, isPartial: false }, theme, { args: argsFor("create_goal") }));
assert(/• create_goal · ship renderer coverage/.test(goalCompact), `create_goal subject should be the objective: ${goalCompact}`);
assert(!goalCompact.includes("\n"), `create_goal compact should be a single line: ${goalCompact}`);
const pendingGoalCompact = renderText(renderersForTool("update_goal").renderResult({
  content: [{ type: "text", text: "Goal updated." }],
  details: {
    ok: true,
    accountingPending: true,
    goal: {
      objective: "ship renderer coverage",
      status: "complete",
      tokensUsed: 0,
      timeUsedSeconds: 0,
    },
  },
}, { expanded: false, isPartial: false }, theme, { args: argsFor("update_goal") }));
assert(pendingGoalCompact.includes("(complete)") && !pendingGoalCompact.includes("\n"), `update_goal compact should carry status in one line: ${pendingGoalCompact}`);
assert(!pendingGoalCompact.includes("0 tokens · 0s"), `update_goal pending accounting should suppress zero counters: ${pendingGoalCompact}`);

const cronCreateCompact = renderText(renderersForTool("cron_create").renderResult(resultFor("cron_create"), { expanded: false, isPartial: false }, theme, { args: argsFor("cron_create") }));
const cronListCompact = renderText(renderersForTool("cron_list").renderResult(resultFor("cron_list"), { expanded: false, isPartial: false }, theme, { args: argsFor("cron_list") }));
const cronListExpanded = renderText(renderersForTool("cron_list").renderResult(resultFor("cron_list"), { expanded: true, isPartial: false }, theme, { args: argsFor("cron_list") }));
const cronDeleteCompact = renderText(renderersForTool("cron_delete").renderResult(resultFor("cron_delete"), { expanded: false, isPartial: false }, theme, { args: argsFor("cron_delete") }));
assert(/• cron_create · cron-a · every 5 minutes · enabled/.test(cronCreateCompact), `cron_create compact should show id, schedule, enabled state: ${cronCreateCompact}`);
assert(/• cron_list · 1 task \(disabled\)/.test(cronListCompact) && !cronListCompact.includes("check status"), `cron_list compact should be one-line count and master state: ${cronListCompact}`);
assert(cronListExpanded.includes("Master switch: disabled") && cronListExpanded.includes("Prompt: check status"), `cron_list expanded should show task details: ${cronListExpanded}`);
assert(/• cron_delete · cron-a \(deleted\)/.test(cronDeleteCompact), `cron_delete compact should show deletion outcome: ${cronDeleteCompact}`);

// Exa search — compact count only; expanded rows with domain/full URL.
const exa = renderersForTool("web_search_exa");
const compactExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: false, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
const expandedExa = renderText(exa.renderResult(resultFor("web_search_exa"), { expanded: true, isPartial: false }, theme, { args: argsFor("web_search_exa") }));
assert(/• web_search_exa · "renderer test" \(12 results\)/.test(compactExa), `web_search_exa subject wrong: ${compactExa}`);
assert(!compactExa.includes("\n") && !compactExa.includes("Result 1"), `web_search_exa compact should not include item rows: ${compactExa}`);
assert(expandedExa.includes("Result 4") && expandedExa.includes("https://example.com/1"), `web_search_exa expanded should show more results with full url: ${expandedExa}`);

// get_code_context_exa — compact query summary; expanded full response.
const codeCompact = renderText(renderersForTool("get_code_context_exa").renderResult(resultFor("get_code_context_exa"), { expanded: false, isPartial: false }, theme, { args: argsFor("get_code_context_exa") }));
const codeExpanded = renderText(renderersForTool("get_code_context_exa").renderResult(resultFor("get_code_context_exa"), { expanded: true, isPartial: false }, theme, { args: argsFor("get_code_context_exa") }));
assert(/• get_code_context_exa · "renderer test"/.test(codeCompact), `get_code_context_exa subject should be the quoted query: ${codeCompact}`);
assert(!codeCompact.includes("\n") && codeExpanded.includes("line-24"), `get_code_context_exa compact should be one line and expanded should show response: ${JSON.stringify({ codeCompact, codeExpanded })}`);

// exa_agent_get_run — single entity `<id> · <status>`; output.text full when expanded.
const runCompact = renderText(renderersForTool("exa_agent_get_run").renderResult(resultFor("exa_agent_get_run"), { expanded: false, isPartial: false }, theme, { args: argsFor("exa_agent_get_run") }));
const runExpanded = renderText(renderersForTool("exa_agent_get_run").renderResult(resultFor("exa_agent_get_run"), { expanded: true, isPartial: false }, theme, { args: argsFor("exa_agent_get_run") }));
assert(/• exa_agent_get_run · run_1 · completed/.test(runCompact), `exa_agent_get_run subject should be id · status: ${runCompact}`);
assert(!runCompact.includes("line-1") && runExpanded.includes("line-1"), `exa_agent_get_run should only show output.text when expanded: ${runExpanded}`);
const listRunsCompact = renderText(renderersForTool("exa_agent_list_runs").renderResult(resultFor("exa_agent_list_runs"), { expanded: false, isPartial: false }, theme, { args: argsFor("exa_agent_list_runs") }));
assert(/• exa_agent_list_runs · recent runs \(12\)/.test(listRunsCompact) && !listRunsCompact.includes("Result 1"), `exa_agent_list_runs compact should be one-line count: ${listRunsCompact}`);

// notification — opaque exec_completion + agent_completion ready signals.
const renderGoalContinuation = goalContinuationMessageRenderer();
const goalContinuationMessage = {
  customType: "taumel.goal.continue",
  content: "Continue working toward the active goal.\n\nFull exact prompt.",
  details: { goal: { objective: "ship renderer coverage", status: "active" }, automation: { continuation: "enabled" } },
};
const compactGoalContinuation = renderText(renderGoalContinuation(goalContinuationMessage, { expanded: false }, theme));
const expandedGoalContinuation = renderText(renderGoalContinuation(goalContinuationMessage, { expanded: true }, theme));
assert(compactGoalContinuation.includes("Goal continuation") && compactGoalContinuation.includes("ship renderer coverage"), `goal continuation compact rendering wrong: ${compactGoalContinuation}`);
assert(!compactGoalContinuation.includes("Full exact prompt"), `goal continuation compact rendering leaked prompt: ${compactGoalContinuation}`);
assert(expandedGoalContinuation.includes("Full exact prompt"), `goal continuation expanded rendering omitted exact prompt: ${expandedGoalContinuation}`);

const renderNotification = notificationMessageRenderer();
const execNote = 'Command session 3 has finished. To read and consume the result, call write_stdin with session_id=3, chars="", yield_time_ms=5000.';
const compactExecNote = renderText(renderNotification({ customType: "notification", content: execNote }, { expanded: false }, theme));
const expandedExecNote = renderText(renderNotification({ customType: "notification", content: execNote }, { expanded: true }, theme));
assertDirectLayout(compactExecNote, "compact exec notification");
assertDirectLayout(expandedExecNote, "expanded exec notification");
assert(compactExecNote.startsWith("• exec_completion"), `exec notification should let Pi provide the outer margin: ${compactExecNote}`);
assert(/• exec_completion · session 3 ready/.test(compactExecNote), `exec notification header wrong: ${compactExecNote}`);
assert(!/exit|code|line-1/.test(compactExecNote), `exec notification should not include terminal status or output: ${compactExecNote}`);
assert(!compactExecNote.includes("\n") && !compactExecNote.includes("write_stdin"), `exec compact notification should be one-line ready signal only: ${compactExecNote}`);
assert(expandedExecNote.includes("Command session 3 has finished") && expandedExecNote.includes("yield_time_ms=5000"), `expanded exec notification should preserve visible body: ${expandedExecNote}`);
const agentNote = JSON.stringify({
  event: "agent_completion", agent_id: "agent-7k2m", run_id: "agent-7k2m-run-1", kind: "generic",
  description: "Inspect renderer coverage", status: "completed",
  next_action: { tool: "agent_wait", arguments: { run_ids: ["agent-7k2m-run-1"], timeout_seconds: 0 } },
});
const compactAgentNote = renderText(renderNotification({ customType: "notification", content: agentNote }, { expanded: false }, theme));
// agentui-i40y/agentui-ald0/agentui-4lce: compact completion is handle + description only.
assert(/^• agent_completion · agent-7k2m · Inspect renderer coverage$/.test(compactAgentNote), `agent completion compact rendering wrong: ${compactAgentNote}`);
const expandedAgentNote = renderText(renderNotification({ customType: "notification", content: agentNote }, { expanded: true }, theme));
// agentui-go7t/agentui-3txs/agentui-pz83/agentui-e5yj: expanded completion is labeled, human-readable metadata only.
for (const expected of [
  "Agent: agent-7k2m",
  "Run: agent-7k2m-run-1",
  "Description: Inspect renderer coverage",
  "Status: completed",
]) {
  assert(expandedAgentNote.includes(expected), `expanded agent completion missing ${expected}: ${expandedAgentNote}`);
}
assert(!expandedAgentNote.includes('{"event"') && !expandedAgentNote.includes("next_action") && !expandedAgentNote.includes("Response:"), `expanded agent completion leaked protocol or response data: ${expandedAgentNote}`);

const statusTheme = {
  ...theme,
  fg: (color, value) => `<${color}>${value}</${color}>`,
};
function completionForStatus(status) {
  const content = JSON.stringify({
    event: "agent_completion",
    agent_id: "agent-7k2m",
    run_id: "agent-7k2m-run-1",
    description: "Inspect renderer coverage",
    status,
  });
  return renderText(renderNotification({ customType: "notification", content }, { expanded: false }, statusTheme));
}
// agentui-f545/agentui-8elv/agentui-svxd/agentui-vr2p: completion dots encode terminal outcome.
assert(completionForStatus("completed").startsWith("<success>•</success>"), "completed agent notification must use a success dot");
assert(completionForStatus("failed").startsWith("<error>•</error>"), "failed agent notification must use an error dot");
assert(completionForStatus("lost").startsWith("<error>•</error>"), "lost agent notification must use an error dot");
assert(completionForStatus("cancelled").startsWith("<muted>•</muted>"), "cancelled agent notification must use a muted dot");
const strictTheme = {
  ...theme,
  fg: (color, value) => {
    if (color === "info") throw new Error("Unknown theme color: info");
    return value;
  },
};
assert(
  /• exec_completion · session 3 ready/.test(renderText(renderNotification({ customType: "notification", content: execNote }, { expanded: false }, strictTheme))),
  "notification renderer should use only real Pi theme tokens",
);

assert(
  renderNotification({ customType: "notification", content: "" }, { expanded: false }, theme) === undefined,
  "empty notification content should render nothing",
);

const renderSkill = skillMessageRenderer();
const skillBlock = [
  '<skill name="foo" location="/skills/foo/SKILL.md">',
  "References are relative to /skills/foo.",
  "",
  longLines,
  "</skill>",
].join("\n");
const skillMessage = { customType: "skill", content: skillBlock, details: { trigger: "$foo" } };
const compactSkill = renderText(renderSkill(skillMessage, { expanded: false }, theme));
const expandedSkill = renderText(renderSkill(skillMessage, { expanded: true }, theme));
const compactSkillLines = renderSkill(skillMessage, { expanded: false }, theme).render(40);
const expandedSkillLines = renderSkill(skillMessage, { expanded: true }, theme).render(40);
if (compactSkillLines[0].startsWith(" [skill]")) {
  assert(!compactSkillLines[0].startsWith("  [skill]"), `native skill renderer must not receive a second outer gutter: ${JSON.stringify(compactSkillLines[0])}`);
  assert(compactSkillLines.every((line) => visibleWidth(line) === 40), `native skill Box should fill the supplied width: ${JSON.stringify(compactSkillLines)}`);
  assert(expandedSkillLines.every((line) => visibleWidth(line) === 40), `expanded native skill Box should fill the supplied width: ${JSON.stringify(expandedSkillLines)}`);
} else {
  assert(compactSkillLines[0].startsWith("•"), `fallback skill renderer should not add an outer gutter: ${JSON.stringify(compactSkillLines[0])}`);
}
assert(/• skill: foo/.test(compactSkill), `skill renderer header wrong: ${compactSkill}`);
assert(compactSkill.includes("auto from $foo") && compactSkill.includes("(expand)") && !compactSkill.includes("line-1"), `skill renderer should default collapsed: ${compactSkill}`);
assert(expandedSkill.includes("because the user mentioned $foo"), `expanded skill renderer should show provenance: ${expandedSkill}`);
assert(expandedSkill.includes("line-24"), `expanded skill renderer should show full body: ${expandedSkill}`);
assert(!expandedSkill.includes("<skill") && !expandedSkill.includes("</skill>"), `expanded skill renderer leaked XML: ${expandedSkill}`);
const multilineSkillBlock = [
  '<skill name="grill-me"',
  ' location="/skills/grill-me/SKILL.md">',
  "References are relative to /skills/grill-me.",
  "",
  "Run a `/grilling` session.",
  "</skill>",
].join("\n");
const compactMultilineSkill = renderText(renderSkill(
  { customType: "skill", content: multilineSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: false },
  theme,
));
const expandedMultilineSkill = renderText(renderSkill(
  { customType: "skill", content: multilineSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: true },
  theme,
));
assert(compactMultilineSkill.includes("grill-me") && compactMultilineSkill.includes("auto from $grill-me"), `multiline skill compact render failed: ${compactMultilineSkill}`);
assert(expandedMultilineSkill.includes("Run a `/grilling` session."), `multiline skill expanded body missing: ${expandedMultilineSkill}`);
assert(!compactMultilineSkill.includes("<skill") && !expandedMultilineSkill.includes("<skill"), `multiline skill renderer leaked XML: ${JSON.stringify({ compactMultilineSkill, expandedMultilineSkill })}`);
const childTagSkillBlock = [
  "<skill>",
  "<name>grill-me</name>",
  "<path>/skills/grill-me/SKILL.md</path>",
  "---",
  "name: grill-me",
  "---",
  "",
  "Run a `/grilling` session.",
  "</skill>",
].join("\n");
const expandedChildTagSkill = renderText(renderSkill(
  { customType: "skill", content: childTagSkillBlock, details: { trigger: "$grill-me" } },
  { expanded: true },
  theme,
));
assert(expandedChildTagSkill.includes("grill-me") && expandedChildTagSkill.includes("Run a `/grilling` session."), `child-tag skill render failed: ${expandedChildTagSkill}`);
assert(!expandedChildTagSkill.includes("<name>") && !expandedChildTagSkill.includes("<path>"), `child-tag skill renderer leaked XML: ${expandedChildTagSkill}`);
assert(
  renderSkill({ customType: "skill", content: "<skill>bad</skill>" }, { expanded: false }, theme) === undefined,
  "invalid skill markup should render nothing",
);

// cron fire — compact one-line task summary, expanded metadata + prompt.
const renderCronFire = cronFireMessageRenderer();
const cronFireMessage = {
  customType: "taumel.cron.fire",
  content: "check disk usage\nrun df -h",
  details: {
    id: "deadbeef",
    cron: "*/5 * * * *",
    schedule: "every 5 minutes",
    coalesced: 1,
    prompt: "check disk usage\nrun df -h",
  },
};
const cronFireCompact = renderText(renderCronFire(cronFireMessage, { expanded: false }, theme));
const cronFireExpanded = renderText(renderCronFire(cronFireMessage, { expanded: true }, theme));
assertDirectLayout(cronFireCompact, "compact cron fire");
assertDirectLayout(cronFireExpanded, "expanded cron fire");
assert(
  cronFireCompact.includes("cron.fire") &&
  cronFireCompact.includes("deadbeef") &&
  cronFireCompact.includes("every 5 minutes"),
  `cron fire compact should show tool name, task id, schedule: ${cronFireCompact}`,
);
assert(!cronFireCompact.includes("\n"), `cron fire compact should be one line: ${cronFireCompact}`);
assert(
  cronFireExpanded.includes("Schedule: */5 * * * *") &&
  cronFireExpanded.includes("Human: every 5 minutes") &&
  cronFireExpanded.includes("check disk usage") &&
  !cronFireExpanded.includes("[cron]"),
  `cron fire expanded should show schedule, human, and prompt, not prefix: ${cronFireExpanded}`,
);

// Coalesced cron fire shows coalesced count.
const coalescedCronFire = renderText(renderCronFire({
  customType: "taumel.cron.fire",
  content: "[cron: 3 coalesced fires]\ncheck status",
  details: {
    id: "feedface",
    cron: "0 * * * *",
    schedule: "every hour",
    coalesced: 3,
    prompt: "check status",
  },
}, { expanded: false }, theme));
assert(
  coalescedCronFire.includes("3 coalesced") &&
  coalescedCronFire.includes("feedface") &&
  coalescedCronFire.includes("every hour"),
  `coalesced cron fire compact should show task id, schedule, coalesced count: ${coalescedCronFire}`,
);

// Empty details (replayed message without structured details) degrades gracefully.
const legacyFallback = renderText(renderCronFire({
  customType: "taumel.cron.fire",
  content: "[cron]\nsimple prompt",
}, { expanded: true }, theme));
assert(
  legacyFallback.includes("simple prompt"),
  `cron fire without structured details should still show content: ${legacyFallback}`,
);

console.log("tool renderer smoke: all assertions passed");
