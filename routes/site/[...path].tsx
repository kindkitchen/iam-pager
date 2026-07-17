import { define } from "../../utils.ts";
import { SiteApp } from "../../components/SiteApp.tsx";

/**
 * Every `/site/*` path serves the SPA shell; client-side routing owns the
 * remainder of the path (001.draft site routing).
 */
export default define.page(function SitePath() {
  return <SiteApp />;
});
