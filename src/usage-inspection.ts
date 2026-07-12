import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type Theme = {
  readonly fg: (color: string, text: string) => string;
};
type UnknownObject = { readonly [name: string]: unknown };

type UsageWindow = {
  readonly label: string;
  readonly durationSeconds?: number;
  readonly percentLeft?: number;
  readonly resetsAt?: number;
  readonly burnRatePerHour?: number;
  readonly exhaustsAt?: number;
  readonly exhaustsBeforeReset?: boolean;
};

export type UsageInspection = {
  readonly accountLabel?: string;
  readonly plan?: string;
  readonly creditsBalance?: number;
  readonly notConfigured: boolean;
  readonly error?: string;
  readonly rateLimits: readonly UsageWindow[];
};

function record(value: unknown): UnknownObject | undefined {
  return typeof value === "object" && value !== null ? value as UnknownObject : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function decodeUsageInspection(value: unknown): UsageInspection {
  const details = record(value) ?? {};
  const rateLimits = Array.isArray(details["rateLimits"])
    ? details["rateLimits"].flatMap((raw): UsageWindow[] => {
        const row = record(raw);
        const label = optionalString(row?.["label"]);
        if (row === undefined || label === undefined) return [];
        return [{
          label,
          ...(optionalNumber(row["durationSeconds"]) === undefined ? {} : { durationSeconds: optionalNumber(row["durationSeconds"]) }),
          ...(optionalNumber(row["percentLeft"]) === undefined ? {} : { percentLeft: optionalNumber(row["percentLeft"]) }),
          ...(optionalNumber(row["resetsAt"]) === undefined ? {} : { resetsAt: optionalNumber(row["resetsAt"]) }),
          ...(optionalNumber(row["burnRatePerHour"]) === undefined ? {} : { burnRatePerHour: optionalNumber(row["burnRatePerHour"]) }),
          ...(optionalNumber(row["exhaustsAt"]) === undefined ? {} : { exhaustsAt: optionalNumber(row["exhaustsAt"]) }),
          ...(typeof row["exhaustsBeforeReset"] === "boolean" ? { exhaustsBeforeReset: row["exhaustsBeforeReset"] } : {}),
        }];
      })
    : [];
  return {
    notConfigured: details["notConfigured"] === true,
    rateLimits: [...rateLimits].sort((a, b) => (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity)),
    ...(optionalString(details["accountLabel"]) === undefined ? {} : { accountLabel: optionalString(details["accountLabel"]) }),
    ...(optionalString(details["plan"]) === undefined ? {} : { plan: optionalString(details["plan"]) }),
    ...(optionalNumber(details["creditsBalance"]) === undefined ? {} : { creditsBalance: optionalNumber(details["creditsBalance"]) }),
    ...(optionalString(details["error"]) === undefined ? {} : { error: optionalString(details["error"]) }),
  };
}

function relativeDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 1) return "under 1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `${minutes}m`;
}

function localTime(targetSeconds: number, nowMs: number): string {
  const target = new Date(targetSeconds * 1000);
  const now = new Date(nowMs);
  const time = target.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = target.getFullYear() === now.getFullYear()
    && target.getMonth() === now.getMonth()
    && target.getDate() === now.getDate();
  if (sameDay) return time;
  if ((target.getTime() - nowMs) <= 7 * 86400 * 1000) {
    return `${target.toLocaleDateString("en", { weekday: "short" })} ${time}`;
  }
  return `${target.toLocaleDateString("en", { day: "2-digit", month: "short" })} ${time}`;
}

function timedEvent(prefix: string, targetSeconds: number, nowMs: number): string {
  return `${prefix} in ${relativeDuration((targetSeconds * 1000 - nowMs) / 1000)}  ·  ${localTime(targetSeconds, nowMs)}`;
}

function quotaColor(percentLeft: number | undefined): string {
  if (percentLeft === undefined) return "dim";
  if (percentLeft <= 10) return "error";
  if (percentLeft <= 25) return "warning";
  return "success";
}

function sanitizeError(error: string): string {
  return error.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function renderUsageInspection(data: UsageInspection, theme: Theme, width: number, nowMs = Date.now()): string[] {
  const w = Math.max(1, width);
  const line = (value: string) => truncateToWidth(value, w, "...");
  const lines: string[] = [theme.fg("accent", " OpenAI Codex Usage"), ""];
  if (data.notConfigured) {
    lines.push(" OpenAI Codex is not configured.", " Sign in with /login and try again.");
  } else if (data.error !== undefined) {
    lines.push(theme.fg("error", " Unable to fetch usage"), ` ${sanitizeError(data.error)}`);
  } else {
    const metadata: [string, string][] = [];
    if (data.accountLabel !== undefined) metadata.push(["Account", data.accountLabel]);
    if (data.plan !== undefined) metadata.push(["Plan", data.plan]);
    if (data.creditsBalance !== undefined) metadata.push(["Credits", data.creditsBalance.toFixed(2)]);
    const labelWidth = metadata.reduce((max, [label]) => Math.max(max, label.length), 0);
    for (const [label, value] of metadata) lines.push(` ${label.padEnd(labelWidth)}   ${value}`);
    if (metadata.length > 0 && data.rateLimits.length > 0) lines.push("");
    if (data.rateLimits.length === 0) lines.push(theme.fg("dim", " No quota windows returned"));
    for (let index = 0; index < data.rateLimits.length; index += 1) {
      const row = data.rateLimits[index]!;
      if (index > 0) lines.push("");
      const label = row.label.replace(/\bLimit\b/, "limit");
      lines.push(` ${label}`);
      const barWidth = Math.max(6, Math.min(20, w - 15));
      const percent = row.percentLeft === undefined ? undefined : Math.max(0, Math.min(100, Math.round(row.percentLeft)));
      const filled = percent === undefined ? 0 : Math.round((percent / 100) * barWidth);
      const bar = `[${"#".repeat(filled)}${"-".repeat(barWidth - filled)}]`;
      lines.push(` ${theme.fg(quotaColor(percent), bar)} ${percent === undefined ? "?" : percent}% left`);
      if (row.resetsAt !== undefined) {
        const reset = timedEvent("Resets", row.resetsAt, nowMs);
        const parts = reset.split("  ·  ");
        if (` ${reset}`.length <= w || parts.length !== 2) lines.push(` ${reset}`);
        else lines.push(` ${parts[0]}`, ` at ${parts[1]}`);
      }
      if (row.burnRatePerHour !== undefined && row.burnRatePerHour >= 0.01) {
        const burn = `Burn ${row.burnRatePerHour.toFixed(1)}%/h`;
        const estimate = row.exhaustsBeforeReset === false
          ? "Safe until reset"
          : row.exhaustsAt === undefined ? undefined : timedEvent("Est. empty", row.exhaustsAt, nowMs);
        const burnLine = `${burn}${estimate === undefined ? "" : `  ·  ${estimate}`}`;
        if (` ${burnLine}`.length <= w || estimate === undefined) lines.push(` ${burnLine}`);
        else lines.push(` ${burn}`, ` ${estimate}`);
      }
    }
  }
  lines.push("", theme.fg("dim", " Esc/q/Enter close"));
  return lines.map(line);
}

export async function showUsageInspection(details: unknown, ctx: unknown): Promise<void> {
  const commandCtx = record(ctx);
  const ui = record(commandCtx?.["ui"]);
  const custom = ui?.["custom"];
  if (typeof custom !== "function") return;
  const data = decodeUsageInspection(details);
  await custom.call(ui, (_tui: unknown, rawTheme: unknown, _keys: unknown, done: () => void) => {
    const theme = record(rawTheme) as Theme | undefined;
    const effectiveTheme: Theme = theme !== undefined && typeof theme.fg === "function"
      ? theme
      : { fg: (_color, text) => text };
    return {
      render: (width: number) => renderUsageInspection(data, effectiveTheme, width),
      invalidate: () => undefined,
      handleInput: (input: string) => {
        if (input === "q" || matchesKey(input, Key.escape) || matchesKey(input, Key.enter)) done();
      },
    };
  });
}
