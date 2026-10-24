import { describe, expect, it } from "vitest";
import { parseInline, parseRichText } from "@/lib/rich-text";

describe("parseRichText", () => {
  it("reads pasted instructions into headings, paragraphs and lists", () => {
    const blocks = parseRichText(
      "**Instructions**\n\nIdentify three problems.\nKeep it short.\n\n1. Address Sierra Leone.\n2. Be *specific*.\n   Very specific.\n\n- one\n- two",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "paragraph",
      "list",
      "list",
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      lines: [[{ type: "strong", children: [{ type: "text", text: "Instructions" }] }]],
    });
    expect(blocks[1]).toMatchObject({ type: "paragraph", lines: [[{}], [{}]] });
    const ordered = blocks[2];
    expect(ordered).toMatchObject({ type: "list", ordered: true, start: 1 });
    if (ordered.type !== "list") throw new Error();
    expect(ordered.items).toHaveLength(2);
    expect(ordered.items[1]).toEqual([
      { type: "text", text: "Be " },
      { type: "em", children: [{ type: "text", text: "specific" }] },
      { type: "text", text: "." },
      { type: "text", text: " " },
      { type: "text", text: "Very specific." },
    ]);
    expect(blocks[3]).toMatchObject({ type: "list", ordered: false });
  });

  it("keeps the starting number of an ordered list", () => {
    expect(parseRichText("3. third\n4. fourth")[0]).toMatchObject({ start: 3 });
  });

  it("reads # headings", () => {
    expect(parseRichText("## Submission")[0]).toEqual({
      type: "heading",
      children: [{ type: "text", text: "Submission" }],
    });
  });
});

describe("parseInline", () => {
  it("links bare URLs without the trailing full stop", () => {
    expect(parseInline("See https://example.com/a.")).toEqual([
      { type: "text", text: "See " },
      { type: "link", href: "https://example.com/a" },
      { type: "text", text: "." },
    ]);
  });

  it("leaves underscores inside words and lone stars alone", () => {
    expect(parseInline("file_name_v2 costs 2 * 3")).toEqual([
      { type: "text", text: "file_name_v2 costs 2 * 3" },
    ]);
  });

  it("treats HTML as text", () => {
    expect(parseInline("<script>x</script>")).toEqual([
      { type: "text", text: "<script>x</script>" },
    ]);
  });
});
