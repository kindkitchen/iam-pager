/** Map pin marking a step whose link is understood as Google Maps stops. */
export function GoogleMapsPin(props: { readonly title?: string }) {
  return (
    <svg
      class="google-maps-pin"
      viewBox="0 0 24 24"
      role={props.title ? "img" : undefined}
      aria-hidden={props.title ? undefined : "true"}
      focusable="false"
    >
      {props.title && <title>{props.title}</title>}
      <path
        class="google-maps-pin-body"
        d="M12 1.5c-4.14 0-7.5 3.28-7.5 7.33 0 5.5 7.5 13.67 7.5 13.67s7.5-8.17 7.5-13.67c0-4.05-3.36-7.33-7.5-7.33z"
      />
      <path
        class="google-maps-pin-road"
        d="M4.9 12.2 12 5.1l2.3 2.3-7.1 7.1z"
      />
      <circle class="google-maps-pin-dot" cx="12" cy="8.8" r="2.7" />
    </svg>
  );
}
