import { ANSI, ANSI_PATTERN } from './constants.js';

export { formatBytes, formatDuration, shortenHome } from '../core/format.js';

type Style = Exclude<keyof typeof ANSI, 'reset'>;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function paint(style: Style, text: string): string {
  return useColor ? `${ANSI[style]}${text}${ANSI.reset}` : text;
}

/** Clickable in terminals that support OSC 8 (iTerm2, Warp, VS Code, Ghostty…); plain text elsewhere. */
export function link(url: string, text: string): string {
  return useColor ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}

export interface TableSection {
  title: string;
  rows: string[][];
}

/**
 * Left-aligned columns shared by every section, so all sections line up. Widths ignore escape
 * codes. A null header prints no header row.
 */
export function table(header: string[] | null, sections: TableSection[]): string {
  const visible = (cell: string) => cell.replace(ANSI_PATTERN, '').length;
  const allRows = sections.flatMap((section) => section.rows);
  const columns = header?.length ?? Math.max(0, ...allRows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(header?.[i]?.length ?? 0, ...allRows.map((row) => visible(row[i] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell + ' '.repeat((widths[i] ?? 0) - visible(cell))))
      .join('  ')
      .trimEnd();
  const out = header ? [paint('dim', line(header))] : [];
  for (const section of sections) {
    if (section.title) {
      if (out.length > 0) out.push('');
      out.push(paint('dim', paint('bold', section.title.toUpperCase())));
    }
    out.push(...section.rows.map(line));
  }
  return out.join('\n');
}
