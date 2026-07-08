import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// A header is `• <name> · <subject>[ <trailing>]`. `lead` is the fully-colored
// `• name · ` prefix; `subject` and `trailing` are separately colored. The
// subject-start column is visibleWidth(lead).
export type HeaderSpec = { readonly lead: string; readonly subject: string; readonly trailing: string };

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
const ELLIPSIS = "…";

export type Block = { readonly header: HeaderSpec; readonly body: Body | undefined };

function terminalSafeWidth(width: number): number {
  const targetWidth = Math.max(1, width);
  return targetWidth > 1 ? targetWidth - 1 : targetWidth;
}

function layoutHeader(header: HeaderSpec, expanded: boolean, width: number): string[] {
  const full =
    header.subject === ""
      ? header.lead + header.trailing
      : header.lead + header.subject + (header.trailing === "" ? "" : " " + header.trailing);
  // Collapsed: always exactly one line, clipped to width.
  // Expanded: one line if it fits, else wrap the subject under a hanging indent
  // aligned to the subject-start column.
  if (!expanded || visibleWidth(full) <= width) {
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

function railEntryPhysical(entry: Entry, expanded: boolean, contentWidth: number): string[] {
  if (entry.exempt) return [entry.text];
  if (expanded) return wrapTextWithAnsi(entry.text, contentWidth);
  return entry.text.split(/\r?\n/).map((line) => truncateToWidth(line, contentWidth, ELLIPSIS));
}

function layoutRail(entries: readonly Entry[], expanded: boolean, width: number): string[] {
  const contentWidth = Math.max(1, width - visibleWidth(RAIL_FIRST));
  const physical = entries.flatMap((entry) => railEntryPhysical(entry, expanded, contentWidth));
  return physical.map((line, index) => (index === 0 ? RAIL_FIRST + line : RAIL_CONT + line));
}

function layoutFlush(entries: readonly Entry[], clip: boolean, width: number): string[] {
  return entries.flatMap((entry) => {
    if (entry.exempt || !clip) return [entry.text];
    return entry.text.split(/\r?\n/).map((line) => truncateToWidth(line, width, ELLIPSIS));
  });
}

export function renderBlock(block: Block, expanded: boolean): { render(width: number): string[]; invalidate(): void } {
  let cache: { width: number; lines: string[] } | undefined;
  return {
    render(width: number): string[] {
      if (cache !== undefined && cache.width === width) return cache.lines;
      const targetWidth = Math.max(1, width);
      const contentWidth = terminalSafeWidth(targetWidth);
      const lines = layoutHeader(block.header, expanded, contentWidth);
      if (block.body !== undefined) {
        if (block.body.mode === "rail") {
          lines.push(...layoutRail(block.body.entries, expanded, contentWidth));
        } else {
          lines.push(...layoutFlush(block.body.entries, block.body.clip, contentWidth));
        }
      }
      const clamped = lines.map((line) => clampLine(line, contentWidth));
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
      return component.render(Math.max(1, targetWidth - 1)).map((line) => clampLine(` ${line}`, targetWidth));
    },
    invalidate() {
      component.invalidate();
    },
  };
}
