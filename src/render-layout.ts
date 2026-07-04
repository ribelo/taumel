import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// A header is `• <name> · <subject>[ <trailing>]`. `lead` is the fully-colored
// `• name · ` prefix; `subject` and `trailing` are separately colored. The
// subject-start column is visibleWidth(lead).
export type HeaderSpec = { readonly lead: string; readonly subject: string; readonly trailing: string };

// A body is either a └-railed block or a flush (self-guttered) block.
//   rail  — first physical line prefixed `  └ `, continuation `    ` (4 spaces).
//            normal entries: collapsed clips each line to (width-4), expanded
//            wraps to (width-4) with continuation at column 4.
//            exempt entries (the `… N more` / expand hints): rendered as-is,
//            never clipped — never clip a line whose job is to advertise hidden
//            content.
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
  const wrapped = wrapTextWithAnsi(header.subject, avail);
  const lines = [header.lead + wrapped[0]];
  for (let index = 1; index < wrapped.length; index += 1) {
    lines.push(indent + wrapped[index]);
  }
  if (header.trailing !== "") {
    lines[lines.length - 1] = lines[lines.length - 1] + " " + header.trailing;
  }
  return lines;
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
      const lines = layoutHeader(block.header, expanded, width);
      if (block.body !== undefined) {
        if (block.body.mode === "rail") {
          lines.push(...layoutRail(block.body.entries, expanded, width));
        } else {
          lines.push(...layoutFlush(block.body.entries, block.body.clip, width));
        }
      }
      cache = { width, lines };
      return lines;
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
      return component.render(Math.max(1, width - 1)).map((line) => ` ${line}`);
    },
    invalidate() {
      component.invalidate();
    },
  };
}
