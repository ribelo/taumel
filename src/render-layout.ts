import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// A header is `• <name> · <subject>[ <trailing>]`. `lead` is the fully-colored
// `• name · ` prefix; `subject` and `trailing` are separately colored. The
// subject-start column is visibleWidth(lead).
export type HeaderSpec = { readonly lead: string; readonly subject: string; readonly trailing: string; readonly subjectClip?: "end" | "middle" };

// A body is either a └-railed block or a flush (self-guttered) block.
//   rail  — first physical line prefixed `  └ `, continuation `    ` (4 spaces).
//            normal entries: collapsed clips each line to (width-4), expanded
//            wraps to (width-4) with continuation at column 4.
//            exempt entries (the `… N more` / expand hints): rendered as-is
//            during body layout; the final component boundary still clamps
//            every physical line to the requested width.
//   flush — self-guttered lines (diffs, apply_patch expanded). no └ rail. each
//            line clipped to width when clip is set (diffs always clip in both
//            modes; they are a structured grid, not a document).
export type Entry = { readonly text: string; readonly exempt?: boolean };
export type Body =
  | { readonly mode: "rail"; readonly entries: readonly Entry[] }
  | { readonly mode: "flush"; readonly entries: readonly Entry[]; readonly clip: boolean };

const RAIL_FIRST = "  └ ";
const RAIL_CONT = "    ";
const LEFT_GUTTER = " ";
const ELLIPSIS = "…";

export type Block = { readonly header: HeaderSpec; readonly body: Body | undefined };

function normalizeTabs(value: string): string {
  // Pi measures tabs as three cells, but terminals expand literal tabs to the
  // next tab stop. Emit the measured spaces so clipping matches physical width.
  return value.replace(/\t/g, "   ");
}

function normalizeBlockTabs(block: Block): Block {
  const lead = normalizeTabs(block.header.lead);
  const subject = normalizeTabs(block.header.subject);
  const trailing = normalizeTabs(block.header.trailing);
  const header = lead === block.header.lead && subject === block.header.subject && trailing === block.header.trailing
    ? block.header
    : { ...block.header, lead, subject, trailing };
  if (block.body === undefined) return header === block.header ? block : { header, body: undefined };
  const needsEntryNormalization = block.body.entries.some((entry) => entry.text.includes("\t"));
  if (!needsEntryNormalization) {
    return header === block.header ? block : { header, body: block.body };
  }
  const entries = block.body.entries.map((entry) => ({ ...entry, text: normalizeTabs(entry.text) }));
  const body = block.body.mode === "rail"
    ? { mode: "rail" as const, entries }
    : { mode: "flush" as const, entries, clip: block.body.clip };
  return { header, body };
}

function terminalSafeWidth(width: number): number {
  const targetWidth = Math.max(1, width);
  return targetWidth > 1 ? targetWidth - 1 : targetWidth;
}

function truncateMiddlePlain(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  if (width <= 1) return truncateToWidth(value, width, ELLIPSIS);
  const chars = [...value];
  const keep = Math.max(0, width - visibleWidth(ELLIPSIS));
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return `${chars.slice(0, left).join("")}${ELLIPSIS}${right === 0 ? "" : chars.slice(-right).join("")}`;
}

function layoutCollapsedHeader(header: HeaderSpec, width: number): string {
  const trailing = header.trailing === "" ? "" : ` ${header.trailing}`;
  const full = header.subject === "" ? header.lead + header.trailing : header.lead + header.subject + trailing;
  if (visibleWidth(full) <= width || header.subject === "" || trailing === "") return truncateToWidth(full, width, ELLIPSIS);
  const subjectWidth = Math.max(1, width - visibleWidth(header.lead) - visibleWidth(trailing));
  const subject = header.subjectClip === "middle"
    ? truncateMiddlePlain(header.subject, subjectWidth)
    : truncateToWidth(header.subject, subjectWidth, ELLIPSIS);
  return truncateToWidth(header.lead + subject + trailing, width, ELLIPSIS);
}

function layoutHeader(header: HeaderSpec, expanded: boolean, width: number): string[] {
  const full =
    header.subject === ""
      ? header.lead + header.trailing
      : header.lead + header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  // Collapsed: always exactly one line, clipped to width.
  // Expanded: one line if it fits, else wrap the subject under a hanging indent
  // aligned to the subject-start column.
  if (!expanded) {
    return [layoutCollapsedHeader(header, width)];
  }
  if (visibleWidth(full) <= width) {
    return [truncateToWidth(full, width, ELLIPSIS)];
  }
  const subjectStart = visibleWidth(header.lead);
  const avail = Math.max(1, width - subjectStart);
  const indent = " ".repeat(subjectStart);
  const tail = header.subject === "" ? header.trailing : header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  const wrapped = wrapTextWithAnsi(tail, avail);
  const lines = [header.lead + wrapped[0]];
  for (let index = 1; index < wrapped.length; index += 1) {
    lines.push(indent + wrapped[index]);
  }
  return lines;
}

function clampLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncateToWidth(line, width, ELLIPSIS) : line;
}

function layoutRail(entries: readonly Entry[], expanded: boolean, width: number): string[] {
  const contentWidth = Math.max(1, width - visibleWidth(RAIL_FIRST));
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.exempt) {
      lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + entry.text);
    } else if (expanded) {
      for (const line of wrapTextWithAnsi(entry.text, contentWidth)) {
        lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + line);
      }
    } else {
      for (const line of entry.text.split(/\r?\n/)) {
        lines.push((lines.length === 0 ? RAIL_FIRST : RAIL_CONT) + truncateToWidth(line, contentWidth, ELLIPSIS));
      }
    }
  }
  return lines;
}

function layoutFlush(entries: readonly Entry[], clip: boolean, width: number): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.exempt || !clip) {
      lines.push(entry.text);
      continue;
    }
    for (const line of entry.text.split(/\r?\n/)) {
      lines.push(truncateToWidth(line, width, ELLIPSIS));
    }
  }
  return lines;
}

export function renderBlock(block: Block, expanded: boolean): { render(width: number): string[]; invalidate(): void } {
  const normalizedBlock = normalizeBlockTabs(block);
  let cache: { width: number; lines: string[] } | undefined;
  return {
    render(width: number): string[] {
      if (cache !== undefined && cache.width === width) return cache.lines;
      const targetWidth = Math.max(1, width);
      const safeWidth = terminalSafeWidth(targetWidth);
      const contentWidth = Math.max(1, safeWidth - visibleWidth(LEFT_GUTTER));
      const lines = layoutHeader(normalizedBlock.header, expanded, contentWidth);
      if (normalizedBlock.body !== undefined) {
        if (normalizedBlock.body.mode === "rail") {
          lines.push(...layoutRail(normalizedBlock.body.entries, expanded, contentWidth));
        } else {
          lines.push(...layoutFlush(normalizedBlock.body.entries, normalizedBlock.body.clip, contentWidth));
        }
      }
      const clamped = lines.map((line) => clampLine(`${LEFT_GUTTER}${line}`, safeWidth));
      cache = { width, lines: clamped };
      return clamped;
    },
    invalidate() {
      cache = undefined;
    },
  };
}

export function emptyComponent(): { render(_width: number): string[]; invalidate(): void } {
  return {
    render(_width: number): string[] {
      return [];
    },
    invalidate() {},
  };
}

export function withLeftGutter(component: { render(width: number): string[]; invalidate(): void }): { render(width: number): string[]; invalidate(): void } {
  return {
    render(width: number): string[] {
      const targetWidth = Math.max(1, width);
      const safeWidth = terminalSafeWidth(targetWidth);
      return component
        .render(Math.max(1, safeWidth - visibleWidth(LEFT_GUTTER)))
        .map((line) => clampLine(`${LEFT_GUTTER}${line}`, safeWidth));
    },
    invalidate() {
      component.invalidate();
    },
  };
}
