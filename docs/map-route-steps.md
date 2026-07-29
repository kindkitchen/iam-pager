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
| Reading a stored link        | `lib/ui/map-link-resolver.ts` (`MapLinkResolver`)        |
| Steps line budget            | `lib/ui/step-editor-limits.ts` (`StepEditorLimits`)      |
| Short-link expansion         | `lib/ui/map-link-expansion.ts`, `/site/maps/expand-link` |
| Frame UI                     | `components/MapRouteFields.tsx`                          |
| Step-input heading line      | `components/MarkdownStepExtensions.tsx`                  |

## Short links are aliases

A shared link such as `https://maps.app.goo.gl/mjUzsCDvmMebA6ac9?g_st=ac`
carries **no place, no coordinates and no stops** — only a key Google resolves
over a redirect, and a browser cannot follow it cross-origin. Every surface
therefore asks `MapLinkResolver` for the _canonical_ URL before parsing
anything:

| State                    | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `canonical`              | Readable as it stands; never touches the network. |
| `foreign`                | Not a Google Maps link.                           |
| `unresolved` / `pending` | An alias, not expanded yet.                       |
| `resolved` / `failed`    | Settled; answered from memory from now on.        |

`RemoteMapLinkResolver` expands **once per distinct alias** through
`POST /site/maps/expand-link` and shares both the in-flight request and its
outcome. In the step editor this means:

- an alias stored in the document is expanded in the background, so its section
  still shows the map pin (pulsing while pending) and can be framed with another
  map step;
- an alias pasted into a Link section's URL is replaced by the place or route it
  stands for, and the frame opens by itself;
- dropping a step whose link is still an alias reports that it is being expanded
  instead of merging it as text.

`StaticMapLinkResolver` satisfies the same contract from a fixed table, which is
how the surface is tested without a network.

## Line budget

Steps re-parses the draft and renders one preview per section on every change,
so the mode is bounded by **physical lines**, not bytes. The bound is a seat
question rather than a Markdown one:

| Access   | Lines  | Surface                                                   |
| -------- | ------ | --------------------------------------------------------- |
| `guest`  | `500`  | `/site/publish` before signing in (the default).          |
| `member` | `1000` | A signed-in creator on `/site/publish` or `/site/manage`. |

A longer draft is never blocked — only Steps steps aside, and Raw keeps editing
the same document. `StepEditorLimits` owns the rule; the surface passes the
access it has already resolved (`PageEditor` → `MarkdownContentEditor`, prop
`access`), so a per-plan or per-page policy can replace it without touching the
editor.

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

## The frame is state, the URL is its projection

A URL cannot express every frame: the Maps URL API says "start from your
location" by _omitting_ `origin`, so a directions link without an origin always
reads back as having that stop. The open frame is therefore kept as editor state
and only re-read from the URL when the URL itself changes; every other edit
keeps the frame and merely relabels it.

The serialization follows the same rule: **one addressable stop is written as a
place link** (`/maps/search/?api=1&query=…`), not as a directions link, so
clearing `Your location` survives saving and reopening. A chosen travel mode
makes it a trip again, and only the directions form can carry it.

A place link addresses a pin by coordinates and has nowhere to carry the name
Maps showed, so **the only stop of a link is named by the link text**. Nothing
derived from the frame — the label of a merge, of a split-out stop, or of a
cleared label — ever degrades into bare numbers. A label that only repeats the
coordinates names nothing and is ignored.

A link that _just became_ a map step also becomes a **list item**
(`listed_map_draft`, `default_map_list_type`): a route is read as a sequence. A
link that was already written as a plain line keeps its own shape, and a list
choice made afterwards is never undone. Splitting a stop out keeps the list
marker of the frame it left.

## The frame

- **Stops** in order, each with its position, role (Origin / Stop /
  Destination), a drag grip, and a remove button. Grips reorder by pointer or
  with `ArrowUp` / `ArrowDown`; the route URL follows immediately. A stop keeps
  the name Maps showed for it (`MapPoint.label`) even when it is addressed by
  coordinates.
- **Start from your location** is a one-click toggle. It adds or removes the
  `Your location` stop, and can only add it in the lead position — the only
  place the Maps URL API can express it (an absent `origin`). Toggling it off
  also clears a stop that an earlier reorder left in the wrong place.
- **Travel mode** — Maps default, driving, walking, bicycling, or transit.
- **Add stop** accepts a Maps link, a route link (all of its stops are added),
  an address, or `lat,lng`. Official short links (`maps.app.goo.gl`,
  `goo.gl/maps`) go through the shared `MapLinkResolver`, backed by
  `POST /site/maps/expand-link`, which only dereferences URLs already classified
  as Google short links.
- **Split out** moves one stop into its own map step directly below.
- Warnings explain the current-location rule, a missing destination, and the
  nine-waypoint limit of the URL API.

## Marking a map section

A section whose link addresses Maps carries `data-map-step` and a Google Maps
pin next to its drag grip; an alias still being expanded carries
`data-map-pending` and a pulsing pin. Dropping onto a map section shows
`Frame as route stops` instead of the plain merge hint.

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
`lib/ui/markdown-map-steps-component.test.tsx`,
`lib/ui/map-link-resolver.test.ts`, `lib/ui/map-link-expansion.test.ts`,
`lib/ui/step-editor-limits.test.ts`,
`lib/ui/markdown-step-limits-component.test.tsx`.
