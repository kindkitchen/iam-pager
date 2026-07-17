import { createDefine } from "fresh";

/** Shared Fresh request state; populated as application middleware is added. */
export type State = Record<string, never>;

export const define = createDefine<State>();
