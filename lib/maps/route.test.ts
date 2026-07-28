import { assertEquals, assertThrows } from "@std/assert";
import { CURRENT_LOCATION, MapsLinkError } from "./model.ts";
import { route_points, to_route_url } from "./route.ts";

const place = "https://www.google.com/maps/search/?api=1&query=50.45,30.52";
const route = "https://www.google.com/maps/dir/?api=1&origin=A&destination=B";

Deno.test("a point becomes a route with an implicit current-location origin", () => {
  assertEquals(
    to_route_url(place),
    "https://www.google.com/maps/dir/?api=1&destination=50.45%2C30.52",
  );
});

Deno.test("an existing route link is returned untouched", () => {
  assertEquals(to_route_url(route), route);
  assertEquals(
    to_route_url("https://maps.google.com/maps?saddr=Kyiv&daddr=Lviv"),
    "https://maps.google.com/maps?saddr=Kyiv&daddr=Lviv",
  );
});

Deno.test("passthrough can be disabled to canonicalise a route", () => {
  assertEquals(
    to_route_url("https://maps.google.com/maps?saddr=Kyiv&daddr=Lviv", {
      passthrough_routes: false,
    }),
    "https://www.google.com/maps/dir/?api=1&origin=Kyiv&destination=Lviv",
  );
});

Deno.test("options force a rebuild with travel mode and navigation", () => {
  assertEquals(
    to_route_url(place, { travel_mode: "walking", dir_action: "navigate" }),
    "https://www.google.com/maps/dir/?api=1&destination=50.45%2C30.52&travelmode=walking&dir_action=navigate",
  );
});

Deno.test("two points build origin and destination", () => {
  assertEquals(
    to_route_url("Kyiv", "Lviv"),
    "https://www.google.com/maps/dir/?api=1&origin=Kyiv&destination=Lviv",
  );
});

Deno.test("intermediate arguments become waypoints", () => {
  assertEquals(
    to_route_url("Kyiv", "Zhytomyr", "Rivne", "Lviv"),
    "https://www.google.com/maps/dir/?api=1&origin=Kyiv&destination=Lviv&waypoints=Zhytomyr%7CRivne",
  );
});

Deno.test("a route argument expands into its own stops", () => {
  assertEquals(
    to_route_url(route, "C"),
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=C&waypoints=B",
  );
});

Deno.test("chained routes are identical to the equivalent point list", () => {
  const chained = to_route_url(
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=B",
    "https://www.google.com/maps/dir/?api=1&origin=B&destination=C",
  );
  assertEquals(chained, to_route_url("A", "B", "C"));
});

Deno.test("current location is honoured only in the lead position", () => {
  const leading = "https://www.google.com/maps/dir/?api=1&destination=B";
  assertEquals(
    to_route_url(leading, "C"),
    "https://www.google.com/maps/dir/?api=1&destination=C&waypoints=B",
  );
  // The implicit current location of a non-first route is dropped: Maps has
  // no way to visit "where the user is" in the middle of a trip.
  assertEquals(
    to_route_url("A", leading),
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=B",
  );
  assertEquals(
    to_route_url(CURRENT_LOCATION, "B", "C"),
    "https://www.google.com/maps/dir/?api=1&destination=C&waypoints=B",
  );
});

Deno.test("travel mode carried by an input survives the merge", () => {
  assertEquals(
    to_route_url(
      "https://www.google.com/maps/dir/?api=1&origin=A&destination=B&travelmode=transit",
      "C",
    ),
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=C&waypoints=B&travelmode=transit",
  );
});

Deno.test("place ids are carried to origin and destination", () => {
  assertEquals(
    to_route_url(
      { kind: "query", query: "Kyiv", place_id: "ChIJ_origin" },
      { kind: "query", query: "Lviv", place_id: "ChIJ_dest" },
    ),
    "https://www.google.com/maps/dir/?api=1&origin=Kyiv&origin_place_id=ChIJ_origin&destination=Lviv&destination_place_id=ChIJ_dest",
  );
});

Deno.test("repeated stops collapse", () => {
  assertEquals(route_points(["A", "A", "B"]).length, 2);
});

Deno.test("short links must be expanded before the sync builder", () => {
  const error = assertThrows(
    () => to_route_url("https://maps.app.goo.gl/abc123"),
    MapsLinkError,
  );
  assertEquals(error.code, "unresolved_short_link");
});

Deno.test("non-location input is rejected", () => {
  const error = assertThrows(
    () => to_route_url("https://example.com/not-maps"),
    MapsLinkError,
  );
  assertEquals(error.code, "unsupported_input");
});

Deno.test("current location alone has no destination", () => {
  const error = assertThrows(
    () => to_route_url(CURRENT_LOCATION),
    MapsLinkError,
  );
  assertEquals(error.code, "no_destination");
});
