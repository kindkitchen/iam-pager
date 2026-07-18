export const SERVER_PORT_ENV = "PORT";

export interface ServerEnvironmentSource {
  get(name: string): string | undefined;
}

export interface ServerConfig {
  readonly port?: number;
}

/** Parses optional process settings before the production server starts. */
export function parse_server_config(
  environment: ServerEnvironmentSource,
): ServerConfig {
  const port_value = environment.get(SERVER_PORT_ENV);
  if (port_value === undefined) return {};

  if (!/^\d{1,5}$/.test(port_value)) {
    throw new TypeError("PORT must be an integer between 0 and 65535");
  }

  const port = Number(port_value);
  if (port > 65_535) {
    throw new TypeError("PORT must be an integer between 0 and 65535");
  }

  return { port };
}
