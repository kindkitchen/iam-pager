import { assertEquals } from "@std/assert";
import {
  is_short_map_link,
  RemoteMapLinkResolver,
  StaticMapLinkResolver,
} from "./map-link-resolver.ts";

const alias = "https://maps.app.goo.gl/mjUzsCDvmMebA6ac9?g_st=ac";
const canonical =
  "https://www.google.com/maps/place/City+of+Whittlesea,+VIC/data=!3d-37.6187516!4d144.963937";
const plain = "https://www.google.com/maps/search/?api=1&query=Kyiv";

function stub(answer: (url: string) => Response) {
  const calls: string[] = [];
  const fetch_impl: typeof fetch = (_input, init) => {
    const url = JSON.parse(String(init?.body ?? "{}")).url as string;
    calls.push(url);
    return Promise.resolve(answer(url));
  };
  return { calls, fetch_impl };
}

function ok(url: string) {
  return Response.json({ url });
}

Deno.test("an alias needs the network, a readable link never does", () => {
  assertEquals(is_short_map_link(alias), true);
  assertEquals(is_short_map_link(plain), false);
  assertEquals(is_short_map_link("https://example.com/x"), false);

  const resolver = new RemoteMapLinkResolver();
  assertEquals(resolver.state(plain), "canonical");
  assertEquals(resolver.resolved(plain), plain);
  assertEquals(resolver.state("https://example.com/x"), "foreign");
  assertEquals(resolver.resolved("https://example.com/x"), null);
  assertEquals(resolver.state(alias), "unresolved");
  assertEquals(resolver.resolved(alias), null);
});

Deno.test("an alias is expanded once and answered from memory after that", async () => {
  const { calls, fetch_impl } = stub(() => ok(canonical));
  const settled: string[] = [];
  const resolver = new RemoteMapLinkResolver({
    fetch: fetch_impl,
    on_settled: (url) => settled.push(url),
  });

  const [first, second] = await Promise.all([
    resolver.resolve(alias),
    resolver.resolve(alias),
  ]);
  assertEquals(first, canonical);
  assertEquals(second, canonical);
  assertEquals(await resolver.resolve(alias), canonical);
  assertEquals(calls, [alias]);
  assertEquals(settled, [alias]);
  assertEquals(resolver.state(alias), "resolved");
  assertEquals(resolver.resolved(alias), canonical);
});

Deno.test("a refused, broken, or non-maps expansion settles as failed", async () => {
  const { calls, fetch_impl } = stub((url) =>
    url.endsWith("junk")
      ? ok("https://example.com/")
      : Response.json({ error: "unreachable" }, { status: 502 })
  );
  const resolver = new RemoteMapLinkResolver({ fetch: fetch_impl });

  assertEquals(await resolver.resolve("https://maps.app.goo.gl/broken"), null);
  assertEquals(await resolver.resolve("https://maps.app.goo.gl/junk"), null);
  assertEquals(resolver.state("https://maps.app.goo.gl/broken"), "failed");
  // A settled failure is never retried on its own.
  await resolver.resolve("https://maps.app.goo.gl/broken");
  assertEquals(calls.length, 2);
});

Deno.test("a transport failure never escapes the resolver", async () => {
  const resolver = new RemoteMapLinkResolver({
    fetch: () => Promise.reject(new Error("offline")),
  });
  assertEquals(await resolver.resolve(alias), null);
});

Deno.test("preloaded expansions satisfy the same contract", async () => {
  const resolver = new StaticMapLinkResolver({ [alias]: canonical });
  assertEquals(resolver.state(alias), "resolved");
  assertEquals(await resolver.resolve(alias), canonical);
  assertEquals(resolver.state("https://maps.app.goo.gl/other"), "unresolved");
  assertEquals(resolver.resolved(plain), plain);
});
