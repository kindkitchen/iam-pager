import { render as render_gfm } from "@deno/gfm";
import type { ContentResult, ContentTypeHandler } from "./interfaces.ts";
import type { DeliveryPayload } from "./model.ts";

export interface MdPageInput {
  /** Required markdown source. */
  md: string;
  /** Optional stylesheet applied only in the raw delivery document. */
  css?: string;
}

export interface MdPageData {
  /** Original markdown, kept as the source of truth. */
  md: string;
  /** Sanitized html derived once at publish time. */
  html: string;
  css?: string;
}

export interface MdPageLimits {
  max_md_bytes: number;
  max_css_bytes: number;
}

/** Default Markdown limits; callers may inject a different policy. */
export const default_md_page_limits: Readonly<MdPageLimits> = {
  max_md_bytes: 64 * 1024,
  max_css_bytes: 16 * 1024,
};

const text_encoder = new TextEncoder();

/**
 * Neutralize `</style>` breakout: `\3c ` is the CSS escape for `<`, so the
 * stylesheet cannot close its `<style>` tag and inject markup.
 */
function escape_css(css: string): string {
  return css.replaceAll("<", "\\3c ");
}

/** Markdown in, sanitized HTML derived at publish time, optional CSS. */
export class MdPageHandler
  implements ContentTypeHandler<MdPageInput, MdPageData> {
  readonly content_type = "md-page";
  readonly supported_delivery_profiles = ["inline"] as const;
  #limits: MdPageLimits;

  constructor(limits: MdPageLimits = default_md_page_limits) {
    if (
      !Number.isSafeInteger(limits.max_md_bytes) ||
      limits.max_md_bytes < 1 ||
      !Number.isSafeInteger(limits.max_css_bytes) ||
      limits.max_css_bytes < 1
    ) {
      throw new Error("MdPage limits must be positive safe integers");
    }
    this.#limits = limits;
  }

  validate(input: unknown): ContentResult<MdPageInput> {
    if (typeof input !== "object" || input === null) {
      return { ok: false, reason: "input must be an object" };
    }
    const { md, css } = input as Record<string, unknown>;
    if (typeof md !== "string" || md.trim() === "") {
      return { ok: false, reason: "md must be a non-empty string" };
    }
    if (css !== undefined && typeof css !== "string") {
      return { ok: false, reason: "css must be a string when present" };
    }
    if (text_encoder.encode(md).byteLength > this.#limits.max_md_bytes) {
      return {
        ok: false,
        reason: `md exceeds ${this.#limits.max_md_bytes} bytes`,
      };
    }
    if (
      css !== undefined &&
      text_encoder.encode(css).byteLength > this.#limits.max_css_bytes
    ) {
      return {
        ok: false,
        reason: `css exceeds ${this.#limits.max_css_bytes} bytes`,
      };
    }
    return { ok: true, value: css === undefined ? { md } : { md, css } };
  }

  to_management(data: MdPageData): MdPageInput {
    return data.css === undefined
      ? { md: data.md }
      : { md: data.md, css: data.css };
  }

  derive(input: MdPageInput): MdPageData {
    const html = render_gfm(input.md);
    return input.css === undefined
      ? { md: input.md, html }
      : { md: input.md, html, css: input.css };
  }

  render(data: MdPageData): DeliveryPayload {
    const style = data.css === undefined
      ? ""
      : `<style>${escape_css(data.css)}</style>`;
    const body = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
${style}
</head>
<body>
${data.html}
</body>
</html>
`;
    return { body, media_type: "text/html; charset=utf-8" };
  }
}
