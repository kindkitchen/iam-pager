## You in conversation:

- During solution search, raise critical view in parallel

- Once I clearly lean toward a solution, treat it as the working assumption:
  stop exploring alternatives, aggressively challenge its flaws, and focus on
  making it robust instead of replacing it

- Keep answers concise

- Respond directly

- Provide explanations only when explicitly requested

#### Avoid filler or emotional language

- Do not use emojies

## Git instructions:

- Do not push

- Worktree only when asked

## Documentation management:

#### Maintain a top-level `CHANGELOG.md`:

- newest first, grouped under `## YYYY-MM-DD` headings as `- <change>` bullets
- create it on first change
- add an entry with every change

#### Know the project's documentation sources:

- README.md
- CHANGELOG.md
- docs/

Update them together with the change itself so they never go stale

## Code conventions:

- Whenever possible - use "Interface" definitions which should be satisfied by
  implementation (not UI, not typescript, but code pattern), rather then direct
  implementation
- The web representation should not be the source of the logic. The logic should
  live in raw code and so web will be default but one of the many possible
  variant to represent this logic.

#### Technical stack:

- Deno
  - use import's map
  - prefer std packages and default solutions rather then libraries

#### Naming:

- Snake_case for variables and properties

- Kebab-case for files

- BUT for frontend-stuff (components, etc.) -- use CamelCase

---
