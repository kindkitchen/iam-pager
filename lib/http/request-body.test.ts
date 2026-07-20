import { assertEquals } from "@std/assert";
import { read_bounded_request_bytes } from "./request-body.ts";

Deno.test("bounded request bytes reject an oversized declared length before reading", async () => {
  const request = new Request("https://pager.test/upload", {
    method: "POST",
    headers: { "content-length": "6" },
    body: new Uint8Array([1]),
  });

  assertEquals(await read_bounded_request_bytes(request, 5), {
    ok: false,
    reason: "too_large",
  });
});

Deno.test("bounded request bytes enforce the stream limit despite a smaller length", async () => {
  const chunks = [new Uint8Array(4), new Uint8Array(2)];
  const request = new Request("https://pager.test/upload", {
    method: "POST",
    headers: { "content-length": "1" },
    body: new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk === undefined) controller.close();
        else controller.enqueue(chunk);
      },
    }),
  });

  assertEquals(await read_bounded_request_bytes(request, 5), {
    ok: false,
    reason: "too_large",
  });
});
