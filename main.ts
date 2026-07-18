import { App, staticFiles } from "fresh";
import { app_services } from "./lib/app.ts";
import { type State } from "./utils.ts";

// Fail startup before accepting requests if provider configuration is invalid.
await app_services();

export const app = new App<State>();

// Static and framework assets take precedence over page-locator delivery.
app.use(staticFiles());

// Include file-system based routes here.
app.fsRoutes();
