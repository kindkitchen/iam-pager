import { marked } from "marked";

export interface PagePreviewInput {
  md: string;
  css?: string;
}

export interface PagePreviewer {
  render(input: PagePreviewInput): string;
}

/**
 * Draft-only browser representation. Publishing remains responsible for
 * authoritative validation, sanitization, and derivation through MdPageHandler.
 */
export class ClientPagePreviewer implements PagePreviewer {
  render(input: PagePreviewInput): string {
    const html = marked.parse(input.md, { async: false });
    const style = input.css === undefined ? "" : `<style>${input.css}</style>`;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
${style}
</head>
<body>
${html}
</body>
</html>
`;
  }
}
