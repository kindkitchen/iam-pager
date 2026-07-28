import { page } from "fresh";
import { Head } from "fresh/runtime";
import BetaMapRouteSteps from "../../islands/BetaMapRouteSteps.tsx";
import { beta_map_steps_preview } from "../../lib/ui/beta-preview.ts";
import { define } from "../../utils.ts";

/**
 * Feature-preview surface. Everything under `/beta/**` renders the previewed
 * step editor; nothing here touches the shipped publish flow.
 */
export const handler = define.handlers({
  GET(ctx) {
    return page(beta_map_steps_preview(ctx.url));
  },
});

export default define.page<typeof handler>(function BetaPreview({ data }) {
  return (
    <>
      <Head>
        <link rel="stylesheet" href="/beta-map-route.css" />
        <title>{data.title}</title>
      </Head>
      <main class="beta-preview">
        <header class="beta-preview-head">
          <p class="beta-badge">Feature preview</p>
          <h1>{data.title}</h1>
          <p>{data.summary}</p>
          <p class="beta-path">
            Preview path: <code>{data.path}</code>
          </p>
        </header>
        <ol class="beta-hints">
          {data.hints.map((hint) => <li key={hint}>{hint}</li>)}
        </ol>
        <BetaMapRouteSteps
          initial_markdown={data.markdown}
          expand_endpoint={data.expand_endpoint}
        />
      </main>
    </>
  );
});
