import GuestPublishForm from "../islands/GuestPublishForm.tsx";
import { FourWordRandomNameGenerator } from "../lib/ui/random-name.ts";

/** Site shell served at `/` and `/site/*`; raw delivery stays separate. */
export function SiteApp() {
  const initial_namespace = new FourWordRandomNameGenerator().generate();
  return (
    <main class="site-app">
      <header class="hero">
        <p class="eyebrow">Content at a URL</p>
        <h1>iam-pager</h1>
        <p class="hero-copy">
          Associate Markdown with a path of your choosing, then share the direct
          page without this site's wrapper.
        </p>
      </header>

      <GuestPublishForm initial_namespace={initial_namespace} />

      <aside class="guest-notice">
        <h2>Guest pages are temporary and unprotected</h2>
        <p>
          Publishing at an existing guest path replaces it. The namespace is not
          reserved, pages are kept only in this running process, and they do not
          appear in search or browsing.
        </p>
      </aside>
    </main>
  );
}
