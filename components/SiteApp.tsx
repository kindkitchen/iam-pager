import GuestPublishForm from "../islands/GuestPublishForm.tsx";
import { FourWordRandomNameGenerator } from "../lib/ui/random-name.ts";
import type {
  SiteNavigation,
  SiteNavigationAction,
} from "../lib/ui/site-navigation.ts";

export interface SiteAppProps {
  readonly navigation: SiteNavigation;
}

/** Site shell served at `/` and `/site/*`; raw delivery stays separate. */
export function SiteApp({ navigation }: SiteAppProps) {
  const initial_namespace = new FourWordRandomNameGenerator().generate();
  return (
    <main class="site-app">
      <header class="hero">
        <SiteSessionNavigation navigation={navigation} />
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

/** Renders an already-authorized server model without inspecting the session. */
export function SiteSessionNavigation(
  { navigation }: { readonly navigation: SiteNavigation },
) {
  return (
    <nav class="site-navigation" aria-label="Session">
      <span class="site-session-state">{navigation.session_label}</span>
      <SiteNavigationAction action={navigation.action} />
    </nav>
  );
}

function SiteNavigationAction(
  { action }: { readonly action: SiteNavigationAction },
) {
  if (action.kind === "link") {
    return (
      <a class="site-navigation-action" href={action.href}>
        {action.label}
      </a>
    );
  }

  return (
    <form
      class="site-navigation-form"
      action={action.action}
      method={action.method}
    >
      {action.fields.map((field) => (
        <input
          key={field.name}
          type="hidden"
          name={field.name}
          value={field.value}
          autocomplete="off"
        />
      ))}
      <button class="site-navigation-action" type="submit">
        {action.label}
      </button>
    </form>
  );
}
