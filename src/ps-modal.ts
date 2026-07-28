import type { CoreBridge } from "./types.ts";
import {
  decodeCoreAck,
  decodeProcessManagerOutput,
  decodeProcessManagerSnapshot,
  type ProcessManagerEntry,
  type ProcessManagerSnapshot,
} from "./bridge-contracts.ts";
import {
  confirmSelection,
  showInteractiveList,
  showScrollModal,
  type ModalTheme,
  type ModalUi,
  wrapModalText,
} from "./modal.ts";

const footer = " ↑↓ move · o output · k kill · q close";

function ownerIdFromContext(ctx: unknown): string {
  if (typeof ctx !== "object" || ctx === null) return "current";
  const record = ctx as { readonly taumelSessionId?: unknown; readonly sessionManager?: unknown };
  if (typeof record.taumelSessionId === "string" && record.taumelSessionId.trim() !== "") {
    return record.taumelSessionId.trim();
  }
  const sessionManager = record.sessionManager;
  if (typeof sessionManager === "object" && sessionManager !== null) {
    const getSessionId = (sessionManager as { readonly getSessionId?: unknown }).getSessionId;
    if (typeof getSessionId === "function") {
      const value = getSessionId.call(sessionManager);
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return "current";
}

function notify(ui: ModalUi | undefined, message: string, level: "info" | "warning" = "warning"): void {
  const fn = ui?.notify;
  if (typeof fn === "function") {
    (fn as (message: string, level: string) => unknown).call(ui, message, level);
  }
}

function loadSnapshot(core: CoreBridge, ownerId: string): ProcessManagerSnapshot {
  return decodeProcessManagerSnapshot(core.call("processManagerSnapshot", [{ ownerId }]));
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function runStateLabel(entry: ProcessManagerEntry): string {
  if (entry.runState === "running") return "running";
  if (entry.exitCode === undefined) return "exited";
  return `exit ${entry.exitCode}`;
}

function runStateColor(entry: ProcessManagerEntry): string {
  return entry.runState === "running" ? "accent" : "dim";
}

function renderSessionRow(
  entry: ProcessManagerEntry,
  _index: number,
  selected: boolean,
  theme: ModalTheme,
  width: number,
): string[] {
  const marker = selected ? theme.fg("accent", "›") : " ";
  const id = String(entry.sessionId).padStart(3, " ");
  const state = runStateLabel(entry);
  const age = formatAge(entry.ageSeconds);
  const meta = ` · ${age}${entry.retained ? " · retained" : ""}`;
  const prefix = `${marker} ${id}  ${state.padEnd(10)}  `;
  const commandBudget = Math.max(1, width - prefix.length - meta.length);
  const command = entry.command.length <= commandBudget
    ? entry.command
    : `${entry.command.slice(0, Math.max(1, commandBudget - 1))}…`;
  return [
    `${marker} ${theme.fg("dim", id)}  ${theme.fg(runStateColor(entry), state.padEnd(10))}  ${theme.fg("toolOutput", command)}${theme.fg("dim", meta)}`,
  ];
}

function emptyLines(theme: ModalTheme, _width: number): string[] {
  return [theme.fg("dim", " No command sessions.")];
}

async function showOutput(
  core: CoreBridge,
  ui: ModalUi | undefined,
  ownerId: string,
  entry: ProcessManagerEntry,
): Promise<void> {
  const output = decodeProcessManagerOutput(core.call("processManagerOutput", [{
    ownerId,
    sessionId: entry.sessionId,
  }]));
  const body = output.available
    ? output.text
    : "Output is no longer available.";
  await showScrollModal(ui, (width, theme) => {
    const header = theme.fg("dim", `Session ${entry.sessionId} · ${entry.command}`);
    const lines = wrapModalText(body, Math.max(1, width)).map((line) => theme.fg("toolOutput", line));
    return [header, "", ...lines];
  });
}

async function killSession(
  core: CoreBridge,
  ui: ModalUi | undefined,
  ownerId: string,
  entry: ProcessManagerEntry,
): Promise<string | undefined> {
  if (entry.runState !== "running") {
    return `session ${entry.sessionId} already completed; cannot kill`;
  }
  if (!await confirmSelection(ui, `Kill session ${entry.sessionId}?`, "Confirm kill")) {
    return undefined;
  }
  try {
    decodeCoreAck(core.call("processManagerKill", [{ ownerId, sessionId: entry.sessionId }]));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function executePsModal(
  core: CoreBridge,
  ctx: unknown,
): Promise<unknown> {
  const ui = (typeof ctx === "object" && ctx !== null
    ? (ctx as { readonly ui?: unknown }).ui
    : undefined) as ModalUi | undefined;
  const ownerId = ownerIdFromContext(ctx);
  let snapshot = loadSnapshot(core, ownerId);
  let cursor = 0;

  while (true) {
    const sessions = snapshot.sessions;
    const selection = await showInteractiveList(ui, {
      items: sessions,
      renderRow: renderSessionRow,
      emptyLines,
      footer,
      actionKeys: ["o", "k"],
      initialIndex: cursor,
    });
    if (selection === undefined) {
      return {
        ok: true,
        action: "command_result",
        message: "Process manager closed.",
        details: snapshot,
        inspection: true,
      };
    }
    cursor = selection.index;
    const selected = sessions[selection.index];
    if (selected === undefined) continue;

    if (selection.key === "o") {
      await showOutput(core, ui, ownerId, selected);
      snapshot = loadSnapshot(core, ownerId);
      continue;
    }

    if (selection.key === "k") {
      const error = await killSession(core, ui, ownerId, selected);
      if (error !== undefined) notify(ui, error, "warning");
      snapshot = loadSnapshot(core, ownerId);
      cursor = Math.min(cursor, Math.max(0, snapshot.sessions.length - 1));
      continue;
    }
  }
}
