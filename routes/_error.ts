import { STATUS_TEXT } from "@std/http/status";
import { HttpError } from "fresh";
import { app_services } from "../lib/app.ts";
import { define } from "../utils.ts";

/** Root error boundary keeps framework failures inside the request contract. */
export const handler = define.handlers(async (context) => {
  const error = context.error;
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error(error);
  const message = error instanceof HttpError && error.message.length > 0
    ? error.message
    : STATUS_TEXT[status] ?? "Internal Server Error";
  const response = new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

  // Session resolution itself may fail before typed state exists. In that case
  // fail closed without trying to issue a credential from incomplete state.
  if (!("request_context" in context.state)) return response;
  return (await app_services()).request_context.decorate(
    context.state,
    response,
  );
});
