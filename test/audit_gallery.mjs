import { renderersForTool, notificationMessageRenderer, cronFireMessageRenderer, goalContinuationMessageRenderer } from "../src/tool-renderer.ts";
import { renderUsageInspection } from "../src/usage-inspection.ts";

const theme = { fg: (_c, v) => v, bold: (v) => v };
const W = 100;

function show(label, lines) {
  console.log(`── ${label} ${"─".repeat(Math.max(2, W - label.length - 4))}`);
  for (const line of lines) console.log(`|${line}|`);
  console.log();
}
const R = (name) => renderersForTool(name);
const call = (name, args) => R(name).renderCall(args, theme, {}).render(W);
const res = (name, args, result, expanded = false) => R(name).renderResult(result, { expanded }, theme, { args }).render(W);

show("exec_command in-flight", call("exec_command", { cmd: "npm run build" }));
show("exec_command ok (compact)", res("exec_command", { cmd: "npm run build" }, { content: [{ type: "text", text: "line1\nline2\nline3" }], details: { ok: true, output: "line1\nline2\nline3", exitCode: 0 } }));
show("exec_command fail (compact)", res("exec_command", { cmd: "false" }, { content: [{ type: "text", text: "boom" }], details: { ok: false, output: "boom", exitCode: 1 } }));
show("exec_command session running", res("exec_command", { cmd: "sleep 100" }, { content: [{ type: "text", text: "Process running with session ID 3" }], details: { ok: true, sessionId: 3 } }));
show("read partial (compact)", res("read", { path: "src/tool-renderer.ts" }, { content: [{ type: "text", text: "x" }], details: { ok: true, path: "src/tool-renderer.ts", totalLines: 774, startLine: 1, shownLines: 200 } }));
show("write append (compact)", res("write", { path: "a.md", mode: "append" }, { content: [{ type: "text", text: "ok" }], details: { ok: true, displayPath: "a.md", mode: "append", contents: "one\ntwo\nthree\nfour\nfive" } }));
show("edit (compact)", res("edit", { path: "src/example.txt" }, { content: [{ type: "text", text: "edited" }], details: { ok: true, displayPath: "src/example.txt", before: "alpha\nbeta\ngamma\ndelta\neps", after: "alpha\nBETA\ngamma\ndelta\neps" } }));
show("view_media (compact)", res("view_media", { path: "/tmp/pi-clipboard-6e6a501780841a8c.png" }, { content: [{ type: "text", text: "Viewed image." }], details: { ok: true, path: "/tmp/pi-clipboard-6e6a501780841a8c.png", width: 2048, height: 768, originalWidth: 4096, originalHeight: 1536, wasResized: true } }));
show("cron_create (compact)", res("cron_create", { cron: "*/5 * * * *" }, { content: [{ type: "text", text: "created" }], details: { ok: true, task: { id: "ab12cd34", schedule: "every 5 minutes", cron: "*/5 * * * *", enabled: true } } }));
show("cron_list (compact)", res("cron_list", {}, { content: [{ type: "text", text: "" }], details: { ok: true, enabled: true, tasks: [{ id: "a" }, { id: "b" }, { id: "c" }] } }));
show("cron_list (expanded)", res("cron_list", {}, { content: [{ type: "text", text: "" }], details: { ok: true, enabled: true, tasks: [{ id: "ab12cd34", schedule: "every 5 minutes", cron: "*/5 * * * *", mode: "goal", recurring: true, enabled: true, nextDueText: "12:00", prompt: "check status" }] } }, true));
show("cron_delete (compact)", res("cron_delete", { id: "ab12cd34" }, { content: [{ type: "text", text: "" }], details: { ok: true, id: "ab12cd34", deleted: true } }));
show("query_threads (compact)", res("query_threads", { query: "renderer" }, { content: [{ type: "text", text: "" }], details: { ok: true, threads: [{ id: "t1", hits: [{}, {}] }] } }));
show("agent_wait (compact)", res("agent_wait", { run_ids: ["r1", "r2"] }, { content: [{ type: "text", text: "" }], details: { ok: true, results: [{}], pending_run_ids: ["r2"] } }));
show("agent_spawn (compact)", res("agent_spawn", { agent_id: "worker-1", tier: "medium", description: "Inspect renderer coverage" }, { content: [{ type: "text", text: "" }], details: { ok: true, agent_id: "worker-1" } }));
show("create_goal (compact)", res("create_goal", { objective: "ship renderer coverage" }, { content: [{ type: "text", text: "Goal created." }], details: { ok: true, goal: { objective: "ship renderer coverage", status: "active" } } }));
show("get_goal (expanded)", res("get_goal", {}, { content: [{ type: "text", text: "Goal is active." }], details: { ok: true, goal: { objective: "ship it", status: "active", tokensUsed: 1200, timeUsage: "3m 20s", goalId: "g1", sessionId: "s1" } } }, true));

const notif = notificationMessageRenderer();
show("notification exec_completion (compact)", notif({ content: "Command session 3 has finished. To read and consume the result, call write_stdin with session_id=3, chars=\"\", yield_time_ms=5000." }, { expanded: false }, theme).render(W));
show("notification exec_completion (expanded)", notif({ content: "Command session 3 has finished. To read and consume the result, call write_stdin with session_id=3, chars=\"\", yield_time_ms=5000." }, { expanded: true }, theme).render(W));
show("notification agent_completion ok (compact)", notif({ content: JSON.stringify({ event: "agent_completion", agent_id: "worker-1", description: "Inspect renderer coverage", status: "completed", run_id: "run-9" }) }, { expanded: false }, theme).render(W));
show("notification agent_completion failed (expanded)", notif({ content: JSON.stringify({ event: "agent_completion", agent_id: "worker-1", description: "Inspect renderer coverage", status: "failed", run_id: "run-9" }) }, { expanded: true }, theme).render(W));

const cronfire = cronFireMessageRenderer();
show("cron.fire (compact)", cronfire({ content: "check status", details: { id: "ab12cd34", schedule: "every 5 minutes", coalesced: 2, cron: "*/5 * * * *", prompt: "check status" } }, { expanded: false }, theme).render(W));
show("cron.fire (expanded)", cronfire({ content: "check status", details: { id: "ab12cd34", schedule: "every 5 minutes", coalesced: 1, cron: "*/5 * * * *", prompt: "check status" } }, { expanded: true }, theme).render(W));

const goalcont = goalContinuationMessageRenderer();
show("goal.continue (compact)", goalcont({ content: "Continue working on the goal.", details: { goal: { objective: "ship renderer coverage" } } }, { expanded: false }, theme).render(W));

show("usage panel", renderUsageInspection({ notConfigured: false, accountLabel: "acct@example.com", plan: "pro", rateLimits: [{ label: "5h Limit", percentLeft: 42, resetsAt: Math.floor(Date.now() / 1000) + 7200, burnRatePerHour: 3.2 }] }, theme, W));
