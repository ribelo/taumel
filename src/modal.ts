import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export type ModalTheme = {
  readonly fg: (color: string, text: string) => string;
};

/** Minimal structural view of pi's ui adapter used by modals. */
export type ModalUi = {
  readonly custom?: unknown;
  readonly select?: unknown;
  readonly input?: unknown;
  readonly notify?: unknown;
};

export type ModalActivityContext = {
  readonly signal: AbortSignal;
  readonly requestRender: () => void;
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

function requestRenderFrom(tui: unknown): () => void {
  return () => {
    const host = typeof tui === "object" && tui !== null
      ? tui as { readonly requestRender?: unknown }
      : undefined;
    if (typeof host?.requestRender === "function") {
      (host.requestRender as () => void).call(host);
    }
  };
}

/**
 * Shared scrollable modal (shared-zetx): arrow-key scrolling, Esc/q/Enter close,
 * theme fallback, dim footer hint. `content` returns the full line list for the
 * given width; the kit windows it.
 */
export async function showScrollModal(
  ui: ModalUi | undefined,
  content: (width: number, theme: ModalTheme) => string[],
  options: {
    readonly footer?: string;
    readonly pageSize?: number;
    readonly activity?: (context: ModalActivityContext) => Promise<void>;
  } = {},
): Promise<void> {
  const custom = ui?.custom;
  if (typeof custom !== "function") return;
  let offset = 0;
  const controller = new AbortController();
  let activityFailure: unknown;
  let activityPromise: Promise<void> | undefined;
  try {
    await (custom as (factory: unknown) => Promise<unknown>).call(ui, (
      tui: unknown,
      rawTheme: unknown,
      _keys: unknown,
      done: () => void,
    ) => {
      const theme = modalTheme(rawTheme);
      const pageSize = options.pageSize ?? defaultPageSize;
      const requestRender = requestRenderFrom(tui);
      if (options.activity !== undefined) {
        activityPromise = options.activity({ signal: controller.signal, requestRender }).catch((error) => {
          activityFailure = error;
        });
      }
      const close = () => {
        controller.abort();
        done();
      };
      return {
        render: (width: number) => {
          const w = Math.max(1, width);
          const lines = content(w, theme);
          offset = Math.min(offset, Math.max(0, lines.length - 1));
          const visible = lines.slice(offset, offset + pageSize);
          const footer = options.footer ?? " ↑↓ scroll · Esc/q/Enter close";
          return [...visible, theme.fg("dim", footer)].map((line) => truncateToWidth(line, w, "..."));
        },
        invalidate: () => undefined,
        handleInput: (input: string) => {
          if (matchesKey(input, Key.up)) {
            offset = Math.max(0, offset - 1);
            requestRender();
            return;
          }
          if (matchesKey(input, Key.down)) {
            offset += 1;
            requestRender();
            return;
          }
          if (input === "q" || matchesKey(input, Key.escape) || matchesKey(input, Key.enter)) close();
        },
      };
    });
  } finally {
    controller.abort();
    await activityPromise;
  }
  if (activityFailure !== undefined) throw activityFailure;
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

export type InteractiveListSelection = {
  readonly key: string;
  readonly index: number;
};

export type InteractiveListOptions<T> = {
  readonly items: readonly T[];
  readonly renderRow: (item: T, index: number, selected: boolean, theme: ModalTheme, width: number) => string[];
  readonly emptyLines?: (theme: ModalTheme, width: number) => string[];
  readonly header?: string | ((theme: ModalTheme) => string);
  readonly footer?: string | ((theme: ModalTheme) => string);
  /** Single-character action keys. Selecting one resolves the modal. */
  readonly actionKeys?: readonly string[];
  readonly pageSize?: number;
  readonly initialIndex?: number;
};

/**
 * Generic interactive list: arrow-key cursor, single-key action dispatch, footer
 * hints. Resolves with the chosen action key + cursor index, or undefined on close.
 * Callers own post-action flows (confirm, text input, reopen).
 */
export async function showInteractiveList<T>(
  ui: ModalUi | undefined,
  options: InteractiveListOptions<T>,
): Promise<InteractiveListSelection | undefined> {
  const custom = ui?.custom;
  if (typeof custom !== "function") return undefined;
  let cursor = Math.max(0, options.initialIndex ?? 0);
  let offset = 0;
  const pageSize = options.pageSize ?? defaultPageSize;
  const actionKeys = new Set(options.actionKeys ?? []);
  return await new Promise<InteractiveListSelection | undefined>((resolve) => {
    let settled = false;
    const settle = (value: InteractiveListSelection | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    void (custom as (factory: unknown) => Promise<unknown>).call(ui, (
      tui: unknown,
      rawTheme: unknown,
      _keys: unknown,
      done: () => void,
    ) => {
      const theme = modalTheme(rawTheme);
      const requestRender = requestRenderFrom(tui);
      const finish = (value: InteractiveListSelection | undefined) => {
        settle(value);
        done();
      };
      const clampCursor = () => {
        if (options.items.length === 0) {
          cursor = 0;
          return;
        }
        cursor = Math.max(0, Math.min(cursor, options.items.length - 1));
      };
      return {
        render: (width: number) => {
          clampCursor();
          const w = Math.max(1, width);
          const body = options.items.length === 0
            ? (options.emptyLines?.(theme, w) ?? [theme.fg("dim", " No items.")])
            : options.items.flatMap((item, index) => options.renderRow(item, index, index === cursor, theme, w));
          if (options.items.length > 0) {
            const sample = options.renderRow(options.items[0]!, 0, false, theme, w);
            const rowHeight = Math.max(1, sample.length);
            const selectedTop = cursor * rowHeight;
            if (selectedTop < offset) offset = selectedTop;
            if (selectedTop + rowHeight > offset + pageSize) {
              offset = Math.max(0, selectedTop + rowHeight - pageSize);
            }
          } else {
            offset = 0;
          }
          const visible = body.slice(offset, offset + pageSize);
          const footer = typeof options.footer === "function"
            ? options.footer(theme)
            : (options.footer ?? " ↑↓ move · q close");
          const header = typeof options.header === "function"
            ? options.header(theme)
            : options.header;
          return [
            ...(header === undefined ? [] : [header]),
            ...visible,
            "",
            theme.fg("dim", footer),
          ].map((line) => truncateToWidth(line, w, "..."));
        },
        invalidate: () => undefined,
        handleInput: (input: string) => {
          if (matchesKey(input, Key.up) || (input === "k" && !actionKeys.has("k"))) {
            if (options.items.length > 0) {
              cursor = Math.max(0, cursor - 1);
              requestRender();
            }
            return;
          }
          if (matchesKey(input, Key.down) || (input === "j" && !actionKeys.has("j"))) {
            if (options.items.length > 0) {
              cursor = Math.min(options.items.length - 1, cursor + 1);
              requestRender();
            }
            return;
          }
          if (input === "q" || matchesKey(input, Key.escape)) {
            finish(undefined);
            return;
          }
          if (actionKeys.has("enter") && matchesKey(input, Key.enter)) {
            finish({ key: "enter", index: cursor });
            return;
          }
          if (!actionKeys.has(input)) return;
          // Empty-state actions (e.g. add) still fire with index 0.
          finish({ key: input, index: cursor });
        },
      };
    }).then(() => {
      // Host dismissed the custom component without handleInput finish.
      settle(undefined);
    }, () => {
      settle(undefined);
    });
  });
}

export async function promptModalText(
  ui: ModalUi | undefined,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  const input = ui?.input;
  if (typeof input !== "function") return undefined;
  const result = await (input as (
    title: string,
    placeholder?: string,
  ) => Promise<unknown>).call(ui, title, placeholder);
  return typeof result === "string" ? result : undefined;
}
