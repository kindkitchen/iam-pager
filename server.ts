import { parse_server_config } from "@/lib/server-config.ts";

interface BuiltServer {
  readonly fetch: Deno.ServeHandler;
}

interface BuiltServerModule {
  readonly default: BuiltServer;
}

const server_config = parse_server_config(Deno.env);
const server_module_url = new URL("./_fresh/server.js", import.meta.url);
const built_server_module = await import(
  server_module_url.href
) as BuiltServerModule;

Deno.serve(server_config, built_server_module.default.fetch);
