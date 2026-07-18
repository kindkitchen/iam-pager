import { createDefine } from "fresh";
import type { AppRequestState } from "./lib/request-context.ts";

/** Shared Fresh request state, populated by the root session middleware. */
export type State = AppRequestState;

export const define = createDefine<State>();
