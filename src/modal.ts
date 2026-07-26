import { Key, matchesKey } from "@earendil-works/pi-tui";

export type ModalTheme = {
  readonly fg: (color: string, text: string) => string;
};

/** Minimal structural view of pi's ui adapter used by modals. */
export type ModalUi = {
  readonly custom?: unknown;
  readonly select?: unknown;
};

const defaultPageSize = 30;

export function modalTheme(rawTheme: unknown): ModalTheme {
  const candidate = typeof rawTheme === "object" && rawTheme !== null
    ? rawTheme as { readonly fg?: unknown }
    : undefined;
  if (candidate !== undefined && typeof candidate.fg === "function") {
    const fg = candidate.fg as (color: string, text: string) => string;
    return { fg: (color, text) => fg.call(candidate, color, text) };
  }
  return { fg: (_color, text) => text };
}

/** Word-wrap plain text to the given width. Wrap before applying theme colors. */
export function wrapModalText(text: string, width: number): string[] {
  const limit = Math.max(1, width);
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let remaining = rawLine;
    while (remaining.length > limit) {
      const breakAt = remaining.lastIndexOf(" ", limit);
      const cut = breakAt > 0 ? breakAt : limit;
      lines.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}

/**
 * Shared scrollable modal (shared-zetx): arrow-key scrolling, Esc/q/Enter close,
 * theme fallback, dim footer hint. `content` returns the full line list for the
 * given width; the kit windows it.
 */
export async function showScrollModal(
  ui: ModalUi | undefined,
  content: (width: number, theme: ModalTheme) => string[],
  options: { readonly footer?: string; readonly pageSize?: number } = {},
): Promise<void> {
  const custom = ui?.custom;
  if (typeof custom !== "function") return;
  let offset = 0;
  await (custom as (factory: unknown) => Promise<unknown>).call(ui, (
    tui: unknown,
    rawTheme: unknown,
    _keys: unknown,
    done: () => void,
  ) => {
    const theme = modalTheme(rawTheme);
    const pageSize = options.pageSize ?? defaultPageSize;
    const requestRender = () => {
      const host = typeof tui === "object" && tui !== null
        ? tui as { readonly requestRender?: unknown }
        : undefined;
      if (typeof host?.requestRender === "function") {
        (host.requestRender as () => void).call(host);
      }
    };
    return {
      render: (width: number) => {
        const lines = content(width, theme);
        offset = Math.min(offset, Math.max(0, lines.length - 1));
        const visible = lines.slice(offset, offset + pageSize);
        const footer = options.footer ?? " ↑↓ scroll · Esc/q/Enter close";
        return [...visible, theme.fg("dim", footer)];
      },
      invalidate: () => undefined,
      handleInput: (input: string) => {
        if (input === "\x1b[A") {
          offset = Math.max(0, offset - 1);
          requestRender();
          return;
        }
        if (input === "\x1b[B") {
          offset += 1;
          requestRender();
          return;
        }
        if (input === "q" || matchesKey(input, Key.escape) || matchesKey(input, Key.enter)) done();
      },
    };
  });
}

/** Canonical confirmation prompt shared by manager flows (shared-zetx). */
export async function confirmSelection(
  ui: ModalUi | undefined,
  title: string,
  confirmLabel: string,
): Promise<boolean> {
  const select = ui?.select;
  if (typeof select !== "function") return false;
  const selected = await (select as (title: string, labels: string[]) => Promise<unknown>).call(
    ui,
    title,
    [confirmLabel, "Cancel"],
  );
  return selected === confirmLabel;
}
