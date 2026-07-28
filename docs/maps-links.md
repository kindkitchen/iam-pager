# Google Maps links

`lib/maps/` turns any Google Maps location link into one directions ("route")
URL. It is pure product logic: no Fresh route, component, or DOM is involved,
and the web surface is only one possible consumer.

## Entry points

| Export                       | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `to_route_url(...)`          | Sync builder, variadic, optional trailing options object.  |
| `to_route_url_async(...)`    | Same, but expands official short links first (needs net).  |
| `parse_google_maps_url(url)` | Recognises a link as point, route, short link, or unknown. |
| `is_route_url(url)`          | True when the link already is a directions link.           |
| `build_route_url(points)`    | Formats an explicit stop list.                             |
| `expand_short_links(inputs)` | Resolves `maps.app.goo.gl` / `goo.gl/maps` targets.        |

Interfaces (`MapLinkParser`, `RouteUrlBuilder`, `ShortLinkResolver`) are the
contract; the exported functions are the default implementations and can be
swapped (cache, proxy, non-Google provider, test double).

## Behaviour

- **Already a route → untouched.** A single argument that parses as directions
  is returned verbatim. Pass `{ passthrough_routes: false }`, a `travel_mode`,
  or `dir_action` to force the canonical `api=1` rebuild.
- **Point → route.** A single place becomes
  `https://www.google.com/maps/dir/?api=1&destination=<point>`. The `origin` is
  deliberately omitted: the Maps app asks for / uses the device location when
  the user is redirected, so no permission is needed to build the link.
- **Many arguments → one chained route.** Stops are used in argument order. A
  route argument contributes all of its own stops (`origin`, `waypoints`,
  `destination`), so `to_route_url(A→B, B→C)` equals `to_route_url(A, B, C)`.
  Consecutive duplicate stops collapse.
- **Current location is lead-only.** An implicit current location (a route
  without `origin`, or `CURRENT_LOCATION`) is kept only as the first stop;
  anywhere else it is dropped, because the URL API cannot express "pass through
  wherever the user is". First position simply means `origin` stays absent.
- **Travel mode** is inherited from the first input that carries one
  (`travelmode=`, legacy `dirflg=`, interactive `!3e`), unless overridden.
- Place ids survive as `origin_place_id` / `destination_place_id`.
- The URL API caps a link at nine waypoints (`MAX_WAYPOINTS`); extra stops are
  not sent.

## Recognised inputs

- documented URL API: `/maps/search/?api=1&query=…`, `/maps/dir/?api=1&origin=…`
- interactive: `/maps/place/Name/@lat,lng,17z/data=…!3d…!4d…`, `/maps/dir/A/B/`,
  `/maps/dir//B` (leading `//` = current location), `/maps/@lat,lng,15z`
- legacy: `?q=`, `?ll=`, `?saddr=&daddr=A to:B`, `?dirflg=`
- official short links: `maps.app.goo.gl/…`, `goo.gl/maps/…` (async only)
- `geo:lat,lng?q=…`, bare `lat,lng`, bare place text

Coordinates found in `data=!3d!4d` win over the viewport `@lat,lng` and over the
place name, because they address the place unambiguously.

Anything else (non-Google host, `cid`-only links that need Google's own
resolution) raises `MapsLinkError` with `unsupported_input` or
`unresolved_short_link`; an empty stop list raises `no_destination`.

## Examples

```ts
import {
  CURRENT_LOCATION,
  to_route_url,
  to_route_url_async,
} from "@/lib/maps/mod.ts";

to_route_url("https://www.google.com/maps/place/Empire+State+Building");
// https://www.google.com/maps/dir/?api=1&destination=Empire+State+Building

to_route_url("https://www.google.com/maps/dir/?api=1&origin=A&destination=B");
// unchanged

to_route_url("Kyiv", "Zhytomyr", "Lviv", { travel_mode: "driving" });
// …dir/?api=1&origin=Kyiv&destination=Lviv&waypoints=Zhytomyr&travelmode=driving

to_route_url(CURRENT_LOCATION, "Office", { dir_action: "navigate" });
// …dir/?api=1&destination=Office&dir_action=navigate

await to_route_url_async("https://maps.app.goo.gl/xxxx", "Office");
```

Tests: `lib/maps/parse.test.ts`, `lib/maps/route.test.ts`,
`lib/maps/short-link.test.ts` (`deno task test`).

## Consumers

- [Map route steps](map-route-steps.md) — the Markdown step editor on
  `/site/publish` shows a Link step whose URL is a Maps link as a frame of
  draggable stops and regenerates the route from their order.
