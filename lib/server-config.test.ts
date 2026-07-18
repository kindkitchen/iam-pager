import { assertEquals, assertThrows } from "@std/assert";
import {
  parse_server_config,
  SERVER_PORT_ENV,
  type ServerEnvironmentSource,
} from "./server-config.ts";

function environment(
  values: Readonly<Record<string, string>>,
): ServerEnvironmentSource {
  return { get: (name) => values[name] };
}

Deno.test("server configuration leaves Deno's default port unspecified", () => {
  assertEquals(parse_server_config(environment({})), {});
});

Deno.test("server configuration accepts the complete TCP port range", () => {
  assertEquals(
    parse_server_config(environment({ [SERVER_PORT_ENV]: "0" })),
    { port: 0 },
  );
  assertEquals(
    parse_server_config(environment({ [SERVER_PORT_ENV]: "5173" })),
    { port: 5173 },
  );
  assertEquals(
    parse_server_config(environment({ [SERVER_PORT_ENV]: "65535" })),
    { port: 65_535 },
  );
});

Deno.test("server configuration rejects invalid ports without echoing values", () => {
  for (
    const value of [
      "",
      "-1",
      "1.5",
      "65536",
      "1e3",
      " 5173",
      "5173 ",
      "not-a-port-secret",
    ]
  ) {
    assertThrows(
      () =>
        parse_server_config(environment({
          [SERVER_PORT_ENV]: value,
        })),
      TypeError,
      "PORT must be an integer between 0 and 65535",
    );
  }

  const secret_error = assertThrows(
    () =>
      parse_server_config(environment({
        [SERVER_PORT_ENV]: "not-a-port-secret",
      })),
    TypeError,
  );
  assertEquals(secret_error.message.includes("not-a-port-secret"), false);
});
