import type { ContentResult, ContentTypeHandler } from "./interfaces.ts";
import type { DeliveryPayload } from "./model.ts";

export interface ExternalUnavailableContent {
  readonly message: "temporarily unavailable";
}

/** Platform-owned visitor fallback with no provider or object information. */
export class ExternalUnavailableContentHandler implements
  ContentTypeHandler<
    null,
    ExternalUnavailableContent,
    ExternalUnavailableContent
  > {
  readonly content_type = "external-unavailable";
  readonly supported_delivery_profiles = ["inline"] as const;

  validate(input: unknown): ContentResult<null> {
    return input === null
      ? { ok: true, value: null }
      : { ok: false, reason: "fallback input must be null" };
  }

  derive(_input: null): ExternalUnavailableContent {
    return { message: "temporarily unavailable" };
  }

  to_management(data: ExternalUnavailableContent): ExternalUnavailableContent {
    return data;
  }

  render(_data: ExternalUnavailableContent): DeliveryPayload {
    return {
      media_type: "text/html; charset=utf-8",
      body: "<!DOCTYPE html>\n" +
        '<html><head><meta charset="utf-8"><meta name="viewport" ' +
        'content="width=device-width, initial-scale=1"><title>Content ' +
        "temporarily unavailable</title></head><body><main>" +
        "<h1>Content temporarily unavailable</h1>" +
        "<p>Please try again later.</p></main></body></html>\n",
    };
  }
}
