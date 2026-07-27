import type { JSX } from "preact";
import type {
  MarkdownBlock,
  MarkdownInline,
} from "../lib/ui/markdown-blocks.ts";

export interface MarkdownDocumentProps {
  readonly blocks: readonly MarkdownBlock[];
  readonly class?: string;
}

/**
 * Renders a parsed, code-owned Markdown document as real elements. No HTML is
 * injected, so the document stays a data structure the server owns.
 */
export function MarkdownDocument(
  { blocks, class: class_name }: MarkdownDocumentProps,
) {
  return (
    <article class={class_name ?? "markdown-document"}>
      {blocks.map((block, index) => (
        <MarkdownBlockView key={index} block={block} />
      ))}
    </article>
  );
}

function MarkdownBlockView({ block }: { readonly block: MarkdownBlock }) {
  switch (block.kind) {
    case "front_matter":
      return (
        <pre class="markdown-front-matter">
          <code>{block.text}</code>
        </pre>
      );
    case "heading": {
      const Heading = `h${block.level}` as keyof JSX.IntrinsicElements;
      return (
        <Heading>
          <MarkdownInlineView content={block.content} />
        </Heading>
      );
    }
    case "paragraph":
      return (
        <p>
          <MarkdownInlineView content={block.content} />
        </p>
      );
    case "list":
      return block.ordered
        ? (
          <ol>
            {block.items.map((item, index) => (
              <li key={index}>
                <MarkdownInlineView content={item} />
              </li>
            ))}
          </ol>
        )
        : (
          <ul>
            {block.items.map((item, index) => (
              <li key={index}>
                <MarkdownInlineView content={item} />
              </li>
            ))}
          </ul>
        );
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index}>
                  <MarkdownInlineView content={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, row_index) => (
              <tr key={row_index}>
                {row.map((cell, cell_index) => (
                  <td key={cell_index}>
                    <MarkdownInlineView content={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "code":
      return (
        <pre class="markdown-code">
          <code>{block.text}</code>
        </pre>
      );
  }
}

function MarkdownInlineView(
  { content }: { readonly content: readonly MarkdownInline[] },
) {
  return (
    <>
      {content.map((run, index) => {
        if (run.kind === "code") return <code key={index}>{run.text}</code>;
        if (run.kind === "strong") {
          return <strong key={index}>{run.text}</strong>;
        }
        if (run.kind === "link") {
          return <a key={index} href={run.href}>{run.text}</a>;
        }
        return run.text;
      })}
    </>
  );
}
