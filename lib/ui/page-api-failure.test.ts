import { assertEquals } from "@std/assert";
import { TypedPageApiFailurePresenter } from "./page-api-failure.ts";

const presenter = new TypedPageApiFailurePresenter();

function body(error: string, detail = "server detail") {
  return { ok: false, error, detail };
}

Deno.test("page API failures distinguish endpoint and authority outcomes", () => {
  assertEquals(
    presenter.present(507, body("endpoint_capacity_exceeded"), {
      operation: "publish",
      content_type: "pdf",
    }),
    {
      kind: "endpoint",
      code: "endpoint_capacity_exceeded",
      message:
        "The selected storage cannot atomically save this many references.",
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

Deno.test("page API failures make external repairs actionable", () => {
  assertEquals(
    presenter.present(422, body("external_content_missing"), {
      operation: "manage",
    }),
    {
      kind: "request",
      code: "external_content_missing",
      message: "That external file could not be found. Choose another copy.",
    },
  );
  assertEquals(
    presenter.present(422, body("external_content_mismatch"), {
      operation: "manage",
    }),
    {
      kind: "request",
      code: "external_content_mismatch",
      message: "The selected file is not a byte-identical copy of this page.",
    },
  );
  assertEquals(
    presenter.present(409, body("connection_revoked"), {
      operation: "manage",
    }),
    {
      kind: "authority",
      code: "connection_revoked",
      message: "Reconnect external storage before trying again.",
    },
  );
  assertEquals(
    presenter.present(409, body("storage_connection_not_found"), {
      operation: "publish",
    }),
    {
      kind: "authority",
      code: "storage_connection_not_found",
      message: "Reconnect external storage before trying again.",
    },
  );
  assertEquals(
    presenter.present(503, body("storage_provider_unavailable"), {
      operation: "publish",
    }).kind,
    "availability",
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
