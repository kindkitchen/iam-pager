export interface PagePreviewInput {
  md: string;
  css?: string;
}

export interface PagePreviewer {
  render(input: PagePreviewInput, signal?: AbortSignal): Promise<string>;
}

export type PreviewFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Browser adapter for the server-owned Markdown representation. */
export class HttpPagePreviewer implements PagePreviewer {
  #endpoint: string;
  #fetch: PreviewFetch;

  constructor(
    endpoint = "/site/api/preview",
    preview_fetch: PreviewFetch = fetch,
  ) {
    this.#endpoint = endpoint;
    this.#fetch = preview_fetch;
  }

  async render(input: PagePreviewInput, signal?: AbortSignal): Promise<string> {
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Preview failed (${response.status})`);
    }
    return await response.text();
  }
}
