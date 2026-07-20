import type { SiteBreadcrumbTrail } from "../lib/ui/site-breadcrumb.ts";

/**
 * Renders a server-owned breadcrumb trail. The last step is the current page
 * and is not a link; earlier steps navigate back toward the site root.
 */
export function SiteBreadcrumb(
  { trail }: { readonly trail: SiteBreadcrumbTrail },
) {
  if (trail.steps.length === 0) return null;
  const last_index = trail.steps.length - 1;
  return (
    <nav class="site-breadcrumb" aria-label="Breadcrumb">
      <ol>
        {trail.steps.map((step, index) => {
          const is_current = index === last_index;
          return (
            <li key={`${index}-${step.label}`}>
              {step.href !== undefined && !is_current
                ? <a href={step.href}>{step.label}</a>
                : (
                  <span aria-current={is_current ? "page" : undefined}>
                    {step.label}
                  </span>
                )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
