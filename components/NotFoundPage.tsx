/** Friendly site-level destination for unmatched routes. */
export function NotFoundPage() {
  return (
    <main class="site-app not-found-page">
      <section class="not-found-card">
        <p class="not-found-code" aria-hidden="true">404</p>
        <p class="eyebrow">Path not found</p>
        <h1>This page wandered off.</h1>
        <p class="not-found-copy">
          The address may be wrong, or the page may no longer be available.
        </p>
        <nav class="not-found-actions" aria-label="Continue browsing">
          <a class="not-found-primary" href="/site/explore">
            Explore public pages
            <span aria-hidden="true">→</span>
          </a>
          <a class="not-found-secondary" href="/site">Go home</a>
        </nav>
      </section>
    </main>
  );
}
