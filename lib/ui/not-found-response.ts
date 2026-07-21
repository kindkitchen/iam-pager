export interface NotFoundResponsePolicy {
  should_render_page(request: Request, response: Response): boolean;
}

/** Keeps direct delivery machine-readable unless a browser requests HTML. */
export class BrowserNotFoundResponsePolicy implements NotFoundResponsePolicy {
  should_render_page(request: Request, response: Response): boolean {
    if (response.status !== 404) return false;
    const accept = request.headers.get("accept");
    if (accept === null) return false;
    return accept.split(",").some((range) => {
      const media_type = range.trim().split(";", 1)[0].toLowerCase();
      return media_type === "text/html" ||
        media_type === "application/xhtml+xml";
    });
  }
}

export const browser_not_found_response_policy: NotFoundResponsePolicy =
  new BrowserNotFoundResponsePolicy();
