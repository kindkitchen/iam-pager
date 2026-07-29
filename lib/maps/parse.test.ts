import { assertEquals } from "@std/assert";
import { is_route_url, parse_google_maps_url } from "./parse.ts";

Deno.test("parses the documented search link as a point", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/search/?api=1&query=50.4501,30.5234",
  );
  assertEquals(link, {
    kind: "point",
    point: { kind: "coords", lat: 50.4501, lng: 30.5234 },
  });
});

Deno.test("parses a search link with a place id", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/search/?api=1&query=Kyiv&query_place_id=ChIJBUVa4U7P1EAR_kYBF9IxSXY",
  );
  assertEquals(link, {
    kind: "point",
    point: {
      kind: "query",
      query: "Kyiv",
      place_id: "ChIJBUVa4U7P1EAR_kYBF9IxSXY",
    },
  });
});

Deno.test("prefers the place coordinates embedded in an interactive link", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/place/Maidan+Nezalezhnosti/@50.4503596,30.5234,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d50.4501!4d30.5234",
  );
  // The name Maps showed rides along as a label; it addresses nothing.
  assertEquals(link, {
    kind: "point",
    point: {
      kind: "coords",
      lat: 50.4501,
      lng: 30.5234,
      label: "Maidan Nezalezhnosti",
    },
  });
});

Deno.test("falls back to the place name when no coordinates are present", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/place/Empire+State+Building",
  );
  assertEquals(link, {
    kind: "point",
    point: { kind: "query", query: "Empire State Building" },
  });
});

Deno.test("parses the legacy q link and the viewport link", () => {
  assertEquals(parse_google_maps_url("https://maps.google.com/?q=Kyiv+Zoo"), {
    kind: "point",
    point: { kind: "query", query: "Kyiv Zoo" },
  });
  assertEquals(
    parse_google_maps_url("https://www.google.com/maps/@50.45,30.52,14z"),
    { kind: "point", point: { kind: "coords", lat: 50.45, lng: 30.52 } },
  );
});

Deno.test("parses a geo uri", () => {
  assertEquals(parse_google_maps_url("geo:0,0?q=50.45,30.52(Home)"), {
    kind: "point",
    point: { kind: "coords", lat: 50.45, lng: 30.52 },
  });
});

Deno.test("parses the documented directions link", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/dir/?api=1&origin=A&destination=B&waypoints=C|D&travelmode=walking",
  );
  assertEquals(link, {
    kind: "route",
    origin: { kind: "query", query: "A" },
    waypoints: [
      { kind: "query", query: "C" },
      { kind: "query", query: "D" },
    ],
    destination: { kind: "query", query: "B" },
    travel_mode: "walking",
  });
});

Deno.test("a directions link without origin keeps the origin implicit", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/dir/?api=1&destination=Lviv",
  );
  assertEquals(link, {
    kind: "route",
    waypoints: [],
    destination: { kind: "query", query: "Lviv" },
  });
});

Deno.test("parses the interactive dir path form with travel mode", () => {
  const link = parse_google_maps_url(
    "https://www.google.com/maps/dir/Kyiv/Lviv/@49.5,27.5,7z/data=!4m2!4m1!3e2",
  );
  assertEquals(link, {
    kind: "route",
    origin: { kind: "query", query: "Kyiv" },
    waypoints: [],
    destination: { kind: "query", query: "Lviv" },
    travel_mode: "walking",
  });
});

Deno.test("an empty first dir segment means current location", () => {
  const link = parse_google_maps_url("https://www.google.com/maps/dir//Lviv");
  assertEquals(link, {
    kind: "route",
    waypoints: [],
    destination: { kind: "query", query: "Lviv" },
  });
});

Deno.test("parses legacy saddr/daddr chains", () => {
  const link = parse_google_maps_url(
    "https://maps.google.com/maps?saddr=Kyiv&daddr=Zhytomyr+to:Lviv&dirflg=b",
  );
  assertEquals(link, {
    kind: "route",
    origin: { kind: "query", query: "Kyiv" },
    waypoints: [{ kind: "query", query: "Zhytomyr" }],
    destination: { kind: "query", query: "Lviv" },
    travel_mode: "bicycling",
  });
});

Deno.test("official short links are reported as unexpanded", () => {
  assertEquals(parse_google_maps_url("https://maps.app.goo.gl/abcDEF123"), {
    kind: "short_link",
    url: "https://maps.app.goo.gl/abcDEF123",
  });
  assertEquals(parse_google_maps_url("https://goo.gl/maps/abcDEF123"), {
    kind: "short_link",
    url: "https://goo.gl/maps/abcDEF123",
  });
});

Deno.test("non maps input is unknown, bare text is a point", () => {
  assertEquals(
    parse_google_maps_url("https://example.com/maps").kind,
    "unknown",
  );
  assertEquals(parse_google_maps_url("50.45, 30.52"), {
    kind: "point",
    point: { kind: "coords", lat: 50.45, lng: 30.52 },
  });
  assertEquals(parse_google_maps_url("Kyiv Zoo"), {
    kind: "point",
    point: { kind: "query", query: "Kyiv Zoo" },
  });
});

Deno.test("is_route_url distinguishes routes from places", () => {
  assertEquals(
    is_route_url("https://www.google.com/maps/dir/?api=1&destination=Lviv"),
    true,
  );
  assertEquals(is_route_url("https://maps.google.com/?q=Lviv"), false);
});
