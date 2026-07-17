export type EditorSource = "markdown" | "css";
export type EditorLayout = "split" | "full-width";

export interface EditorWorkspaceState {
  readonly expanded: boolean;
  readonly source: EditorSource;
  readonly layout: EditorLayout;
}

export interface EditorWorkspaceController {
  initial_state(): EditorWorkspaceState;
  set_expanded(
    state: EditorWorkspaceState,
    expanded: boolean,
  ): EditorWorkspaceState;
  select_source(
    state: EditorWorkspaceState,
    source: EditorSource,
  ): EditorWorkspaceState;
  select_layout(
    state: EditorWorkspaceState,
    layout: EditorLayout,
  ): EditorWorkspaceState;
}

export class DeterministicEditorWorkspace implements EditorWorkspaceController {
  initial_state(): EditorWorkspaceState {
    return { expanded: true, source: "markdown", layout: "split" };
  }

  set_expanded(
    state: EditorWorkspaceState,
    expanded: boolean,
  ): EditorWorkspaceState {
    return { ...state, expanded };
  }

  select_source(
    state: EditorWorkspaceState,
    source: EditorSource,
  ): EditorWorkspaceState {
    return { ...state, source };
  }

  select_layout(
    state: EditorWorkspaceState,
    layout: EditorLayout,
  ): EditorWorkspaceState {
    return { ...state, layout };
  }
}
