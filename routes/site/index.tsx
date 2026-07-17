import { define } from "../../utils.ts";
import { SiteApp } from "../../components/SiteApp.tsx";

/** `/site` is the alias for the site page; the namespace is forbidden. */
export default define.page(function Site() {
  return <SiteApp />;
});
