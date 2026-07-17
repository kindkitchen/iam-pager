import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";

export const app = new App<State>();

// Static and framework assets take precedence over page-locator delivery.
app.use(staticFiles());

// Include file-system based routes here.
app.fsRoutes();

// Import CSS files here for hot module reloading to work.
import "./assets/styles.css";
