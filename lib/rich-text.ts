// A small subset of Markdown for assignment instructions, which lecturers
// often paste from a document: paragraphs, "1." and "-" lists, "#"
// headings, **bold**, *italic* and bare links. Parsed into plain data so
// nothing typed is ever treated as HTML. Safe to import from client
// components.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string };

export type Block =
  | { type: "heading"; children: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<Block, { type: "list" }> | null = null;

  const close = () => {
    paragraph = null;
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);

    if (heading) {
      close();
      blocks.push({ type: "heading", children: parseInline(heading[1]) });
    } else if (ordered || bullet) {
      const isOrdered = Boolean(ordered);
      const text = ordered ? ordered[2] : bullet![1];
      if (!list || list.ordered !== isOrdered) {
        paragraph = null;
        list = {
          type: "list",
          ordered: isOrdered,
          start: ordered ? Number(ordered[1]) : 1,
          items: [],
        };
        blocks.push(list);
      }
      list.items.push(parseInline(text));
    } else if (list && /^\s+/.test(raw)) {
      // An indented line continues the list item above it.
      list.items[list.items.length - 1].push(
        { type: "text", text: " " },
        ...parseInline(line.trim()),
      );
    } else {
      list = null;
      if (!paragraph) {
        paragraph = [];
        blocks.push({ type: "paragraph", lines: paragraph });
      }
      paragraph.push(parseInline(line.trim()));
    }
  }
  return blocks;
}

const TOKEN = /\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|(?<![\w])_(\S(?:.*?\S)?)_(?![\w])|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = TOKEN.exec(rest);
    if (!match) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (match.index > 0) {
      out.push({ type: "text", text: rest.slice(0, match.index) });
    }
    const [whole, bold, bold2, em, em2, url] = match;
    if (bold ?? bold2) {
      out.push({ type: "strong", children: parseInline(bold ?? bold2) });
    } else if (em ?? em2) {
      out.push({ type: "em", children: parseInline(em ?? em2) });
    } else {
      out.push({ type: "link", href: url });
    }
    rest = rest.slice(match.index + whole.length);
  }
  return out;
}
