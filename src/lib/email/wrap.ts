// Plain-text lines stay under 70 characters, broken at spaces. A key: value
// row that runs long continues on lines indented two spaces, never on
// space-aligned columns.

export const MAX_LINE = 69;

/** Greedy word wrap. A single word longer than the width is left whole; the lint catches it. */
export function wrap(text: string, width = MAX_LINE, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const lead = lines.length === 0 ? "" : indent;
    if (!line) {
      line = lead + w;
    } else if (line.length + 1 + w.length <= width) {
      line += ` ${w}`;
    } else {
      lines.push(line);
      line = indent + w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** "Label: value", continuation lines indented two spaces. */
export function wrapRow(label: string, value: string, width = MAX_LINE): string[] {
  return wrap(`${label}: ${value}`, width, "  ");
}
