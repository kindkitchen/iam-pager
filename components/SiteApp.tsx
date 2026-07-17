/**
 * The site shell served at "/" and under the "/site" alias (001.draft).
 * Raw content delivery never renders this wrapper. The guest publish flow
 * mounts here in the next slice.
 */
export function SiteApp() {
  return (
    <main class="site-app">
      <h1>iam-pager</h1>
      <p>
        Associate content with a URL of your choosing and share the direct link.
        Pages open raw, without this site around them.
      </p>
      <p>
        Guest publishing lands here next: pick a namespace, submit markdown, get
        a direct URL.
      </p>
    </main>
  );
}
