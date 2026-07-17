import { define } from "../utils.ts";
import { SiteApp } from "../components/SiteApp.tsx";

/** The raw domain root serves the site itself, not raw content. */
export default define.page(function Home() {
  return <SiteApp />;
});
