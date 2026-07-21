import { assertEquals } from "@std/assert";
import { TypedPageApiFailurePresenter } from "./page-api-failure.ts";

const presenter = new TypedPageApiFailurePresenter();

function body(error: string, detail = "server detail") {
  return { ok: false, error, detail };
}

Deno.test("page API failures distinguish endpoint and authority outcomes", () => {
  assertEquals(
    presenter.present(422, body("namespace_mismatch"), {
      operation: "publish",
      content_type: "pdf",
    }),
    {
      kind: "endpoint",
      code: "namespace_mismatch",
      message: "Every PDF endpoint must use the canonical namespace.",
    },
  );
  assertEquals(
    presenter.present(409, body("namespace_not_reserved"), {
      operation: "publish",
    }),
    {
      kind: "authority",
      code: "namespace_not_reserved",
      message: "Reserve this namespace before publishing as a creator.",
    },
  );
  assertEquals(
    presenter.present(404, body("not_found"), { operation: "manage" }),
    {
      kind: "authority",
      code: "not_found",
      message: "This page is missing or no longer available to this account.",
    },
  );
});

Deno.test("page API failures distinguish PDF, size, and stale outcomes", () => {
  assertEquals(
    presenter.present(
      422,
      body("invalid_input", "bytes must begin with a supported PDF header"),
      { operation: "publish", content_type: "pdf" },
    ),
    {
      kind: "pdf",
      code: "invalid_input",
      message: "The file does not begin with a supported PDF header.",
    },
  );
  assertEquals(
    presenter.present(
      422,
      body("invalid_input", "adapter keyspace /private/path"),
      { operation: "manage", content_type: "pdf" },
    ),
    {
      kind: "pdf",
      code: "invalid_input",
      message: "The selected file was not accepted as a PDF.",
    },
  );
  assertEquals(
    presenter.present(413, body("request_too_large"), {
      operation: "manage",
      content_type: "pdf",
    }),
    {
      kind: "size",
      code: "request_too_large",
      message: "The PDF upload is larger than the accepted limit.",
    },
  );
  assertEquals(
    presenter.present(412, body("precondition_failed"), {
      operation: "manage",
    }),
    {
      kind: "stale",
      code: "precondition_failed",
      message:
        "This page changed elsewhere. Review the refreshed page before trying again.",
    },
  );
});

Deno.test("page API failures hide unknown detail and type server failures", () => {
  assertEquals(
    presenter.present(
      418,
      body("unexpected", "adapter keyspace /private/path"),
      { operation: "manage" },
    ),
    {
      kind: "request",
      code: "unexpected",
      message: "Page management failed (418).",
    },
  );
  assertEquals(
    presenter.present(503, "not json", { operation: "publish" }),
    {
      kind: "availability",
      code: null,
      message: "Publishing failed (503).",
    },
  );
});
