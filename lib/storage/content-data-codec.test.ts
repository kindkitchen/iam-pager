import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  content_data_encoding_v8_1,
  V8ContentDataCodec,
} from "./content-data-codec.ts";

const prototype_fixture = Uint8Array.from(
  atob(
    "/w9vIgVieXRlc1wBBAAB/v8iCGZpbGVuYW1lIgpy6XN1bekucGRmIgtwZGZfdmVyc2lvbiIDMi4wewM=",
  ),
  (character) => character.charCodeAt(0),
);

Deno.test("V8 content codec retains the prototype payload format under an explicit version", () => {
  const codec = new V8ContentDataCodec();
  const value = {
    bytes: Uint8Array.of(0, 1, 254, 255),
    filename: "résumé.pdf",
    pdf_version: "2.0",
  };

  assertEquals(codec.encoding_version, content_data_encoding_v8_1);
  assertEquals(codec.encode(value), prototype_fixture);
  assertEquals(codec.decode(prototype_fixture), value);
});

Deno.test("V8 content codec round-trips detached Markdown and PDF data", () => {
  const codec = new V8ContentDataCodec();
  const markdown = {
    md: "# Durable",
    html: "<h1>Durable</h1>",
    css: "h1 { color: green; }",
  };
  assertEquals(codec.decode(codec.encode(markdown)), markdown);

  const backing = Uint8Array.of(9, 0, 1, 2, 3, 8);
  const pdf = {
    bytes: backing.subarray(1, 5),
    filename: "document.pdf",
    pdf_version: "1.7",
  };
  const encoded = codec.encode(pdf);
  backing.fill(7);
  const decoded = codec.decode(encoded) as typeof pdf;
  assertEquals(decoded, {
    bytes: Uint8Array.of(0, 1, 2, 3),
    filename: "document.pdf",
    pdf_version: "1.7",
  });
  decoded.bytes.fill(6);
  assertEquals(
    (codec.decode(encoded) as typeof pdf).bytes,
    Uint8Array.of(0, 1, 2, 3),
  );
});

Deno.test("V8 content codec rejects unsupported and malformed values", async () => {
  const codec = new V8ContentDataCodec();
  assertThrows(
    () => codec.encode({ callback: () => undefined }),
    TypeError,
    "must be V8-serializable",
  );
  assertThrows(
    () => codec.decode(new Uint8Array()),
    TypeError,
    "invalid V8-encoded content data",
  );
  await assertRejects(
    () => Promise.resolve().then(() => codec.decode(Uint8Array.of(1, 2, 3))),
    TypeError,
    "invalid V8-encoded content data",
  );
});
