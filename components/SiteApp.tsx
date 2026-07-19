import PagePublishForm from "../islands/PagePublishForm.tsx";
import NamespaceReservationPanel from "../islands/NamespaceReservationPanel.tsx";
import type { NamespacePanel } from "../lib/ui/namespace-panel.ts";
import { FourWordRandomNameGenerator } from "../lib/ui/random-name.ts";
import type {
  SiteNavigation,
  SiteNavigationAction,
} from "../lib/ui/site-navigation.ts";

export interface SiteAppProps {
  readonly navigation: SiteNavigation;
  readonly namespace_panel: NamespacePanel;
}

/** Site shell served at `/` and `/site/*`; raw delivery stays separate. */
export function SiteApp({ navigation, namespace_panel }: SiteAppProps) {
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

      {namespace_panel.kind === "creator" && (
        <NamespaceReservationPanel
          csrf_token={namespace_panel.csrf_token}
          initial_reservations={namespace_panel.reservations}
        />
      )}

      <PagePublishForm
        initial_namespace={initial_namespace}
        publisher_kind={namespace_panel.kind === "creator"
          ? "creator"
          : "guest"}
      />

      <aside class="guest-notice">
        <h2>
          {namespace_panel.kind === "creator"
            ? "Unreserved pages remain unprotected"
            : "Guest pages are unprotected"}
        </h2>
        <p>
          Publishing at an existing unreserved path replaces it, and those pages
          do not appear in search or browsing. Reserve the namespace first to
          protect it from guest and cross-creator writes.
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
