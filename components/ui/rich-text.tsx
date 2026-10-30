import { Fragment } from "react";
import { type Inline, linkLabel, parseRichText } from "@/lib/rich-text";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : node.type === "strong" ? (
      <strong key={i} className="font-semibold">
        <Inlines nodes={node.children} />
      </strong>
    ) : node.type === "em" ? (
      <em key={i}>
        <Inlines nodes={node.children} />
      </em>
    ) : (
      <a
        key={i}
        href={node.href}
        title={node.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium break-all text-accent-strong underline underline-offset-4"
      >
        {linkLabel(node.href)}
      </a>
    ),
  );
}

// Assignment instructions as written by the lecturer, see lib/rich-text.ts.
// With headingLevel, the lecturer's "#" lines become real headings that a
// screen reader can jump between; without it they are bold paragraphs.
export function RichText({
  text,
  className = "",
  headingLevel,
}: {
  text: string;
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div className={`max-w-prose space-y-3 leading-relaxed ${className}`}>
      {parseRichText(text).map((block, i) =>
        block.type === "heading" ? (
          <Heading key={i} className="pt-1 font-semibold text-ink">
            <Inlines nodes={block.children} />
          </Heading>
        ) : block.type === "paragraph" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inlines nodes={line} />
              </Fragment>
            ))}
          </p>
        ) : block.ordered ? (
          <ol
            key={i}
            start={block.start}
            className="list-decimal space-y-1.5 pl-5 marker:text-muted marker:tabular-nums"
          >
            {block.items.map((item, j) => (
              <li key={j} className="pl-1">
                <Inlines nodes={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-muted">
            {block.items.map((item, j) => (
              <li key={j} className="pl-1">
                <Inlines nodes={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
