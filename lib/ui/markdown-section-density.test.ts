import { assertEquals } from "@std/assert";
import { DeterministicMarkdownSectionDensity } from "./markdown-section-density.ts";

const controller = new DeterministicMarkdownSectionDensity();

Deno.test("Markdown sections default to whole content density", () => {
  assertEquals(controller.reconcile([], 3), ["whole", "whole", "whole"]);
});

Deno.test("section density survives content-count reconciliation", () => {
  const compact = controller.toggle(
    controller.reconcile([], 2),
    1,
  );

  assertEquals(controller.reconcile(compact, 2), ["whole", "compact"]);
  assertEquals(controller.reconcile(compact, 3), [
    "whole",
    "compact",
    "whole",
  ]);
});

Deno.test("section density follows moves and removals", () => {
  const densities = ["whole", "compact", "whole"] as const;
  const moved = controller.move(densities, 1, 0);

  assertEquals(moved, ["compact", "whole", "whole"]);
  assertEquals(controller.remove(moved, 0), ["whole", "whole"]);
});
