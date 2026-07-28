# Map route steps

The Markdown step editor (`/site/publish`, Steps mode) offers a **map step**: a
Link step whose URL is a Google Maps place or route, edited as an ordered list
of stops instead of a bare URL. The document never changes shape — a map step is
still one `[label](url)` line — and every edit regenerates the route through
[`lib/maps`](maps-links.md) from the visible top-to-bottom order.

| Concern                      | Owner                                                    |
| ---------------------------- | -------------------------------------------------------- |
| Stop model and editing rules | `lib/ui/map-route-steps.ts` (`MapRouteStepEditor`)       |
| Offered inputs and variants  | `lib/ui/step-editor-config.ts` (`StepEditorPreferences`) |
| Remembering the choice       | `lib/ui/step-editor-config-store.ts`                     |
| Short-link expansion         | `lib/ui/map-link-expansion.ts`, `/site/maps/expand-link` |
| Frame UI                     | `components/MapRouteFields.tsx`                          |
| Step-input heading line      | `components/MarkdownStepExtensions.tsx`                  |

## Step inputs heading line

Steps mode opens with a heading line listing every step input as a checkbox:
Text, Heading, Link, Code block, Raw Markdown. Unchecking one removes it from
the insertion picker and from the per-section Type select. **Text can never be
switched off**, so the editor always has one input left.

An input with more than one behaviour puts its checkbox _in front of a select_.
Today that is the Link input:

| Variant         | Behaviour                                                         |
| --------------- | ----------------------------------------------------------------- |
| `simple`        | Label and URL only.                                               |
| `map` (default) | Label and URL, plus the Google Maps stop frame when the URL fits. |

## Simple ⇄ map

Inside a Link section the map variant adds a **Google Maps route** checkbox:

- **Simple is always possible.** Unchecking returns to plain label and URL; the
  URL is left exactly as it is.
- **Map is offered after validation.** Checking it parses the URL first. If it
  is not a Google Maps place or route link, the editor says so and _nothing
  happens_ — no conversion, no rewrite.
- Toggling alone never edits the document. The URL is rewritten only when a stop
  is actually changed.

While inserting a new Link step the frame appears on its own as soon as the
pasted URL is a Maps link, so there is nothing extra to switch on.

## The frame

- **Stops** in order, each with its position, role (Origin / Stop /
  Destination), a drag grip, and a remove button. Grips reorder by pointer or
  with `ArrowUp` / `ArrowDown`; the route URL follows immediately.
- **Start from your location** is a one-click toggle. It adds or removes the
  `Your location` stop, and can only add it in the lead position — the only
  place the Maps URL API can express it (an absent `origin`). Toggling it off
  also clears a stop that an earlier reorder left in the wrong place.
- **Travel mode** — Maps default, driving, walking, bicycling, or transit.
- **Add stop** accepts a Maps link, a route link (all of its stops are added),
  an address, or `lat,lng`. Official short links (`maps.app.goo.gl`,
  `goo.gl/maps`) are expanded by `POST /site/maps/expand-link`, which only
  dereferences URLs already classified as Google short links.
- **Split out** moves one stop into its own map step directly below.
- Warnings explain the current-location rule, a missing destination, and the
  nine-waypoint limit of the URL API.

## Dropping one map step on another

The step editor's existing drop-to-merge gesture is _not_ a text merge when both
sections are map links: their points are joined into a single ordered route, a
repeated place at the seam collapses, and the label follows the stops
(`Lviv → Stryi → Uzhhorod`) until it is customised. Any other combination keeps
the shipped behaviour of appending the dropped value.

## Configuration as JSON

The heading-line state is one JSON-serializable value:

```json
{
  "version": 1,
  "inputs": {
    "text": { "enabled": true, "variant": "" },
    "heading": { "enabled": true, "variant": "" },
    "link": { "enabled": true, "variant": "map" },
    "code-block": { "enabled": false, "variant": "" },
    "raw": { "enabled": true, "variant": "" }
  }
}
```

`normalize_step_editor_config` accepts _anything_ a store may return — `null`, a
partial object, unknown inputs, unknown variants — and yields a valid
configuration, so the same object works as stored preference and as the editor's
initial state (`initial_step_config`). `MarkdownContentEditor` also reports
every change through `on_step_config_change`.

Persistence goes through `StepEditorConfigStore`. The browser implementation
keeps the choice in web storage across renders and sessions; a per-user server
profile can replace it later without touching the editor, since the stored value
is exactly the JSON above.

Tests: `lib/ui/map-route-steps.test.ts`, `lib/ui/step-editor-config.test.ts`,
`lib/ui/map-route-fields-component.test.tsx`,
`lib/ui/markdown-step-inputs-component.test.tsx`,
`lib/ui/map-link-expansion.test.ts`.
