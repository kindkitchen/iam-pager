export type MarkdownSectionDensity = "whole" | "compact";
export type MarkdownSectionDensities = readonly MarkdownSectionDensity[];

export interface MarkdownSectionDensityController {
  reconcile(
    densities: MarkdownSectionDensities,
    section_count: number,
  ): MarkdownSectionDensities;
  toggle(
    densities: MarkdownSectionDensities,
    index: number,
  ): MarkdownSectionDensities;
  move(
    densities: MarkdownSectionDensities,
    from_index: number,
    to_index: number,
  ): MarkdownSectionDensities;
  remove(
    densities: MarkdownSectionDensities,
    index: number,
  ): MarkdownSectionDensities;
}

export class DeterministicMarkdownSectionDensity
  implements MarkdownSectionDensityController {
  reconcile(
    densities: MarkdownSectionDensities,
    section_count: number,
  ): MarkdownSectionDensities {
    return Array.from(
      { length: section_count },
      (_, index) => densities[index] ?? "whole",
    );
  }

  toggle(
    densities: MarkdownSectionDensities,
    index: number,
  ): MarkdownSectionDensities {
    return densities.map((density, candidate_index) =>
      candidate_index === index
        ? density === "whole" ? "compact" : "whole"
        : density
    );
  }

  move(
    densities: MarkdownSectionDensities,
    from_index: number,
    to_index: number,
  ): MarkdownSectionDensities {
    const next = [...densities];
    const [moved] = next.splice(from_index, 1);
    next.splice(to_index, 0, moved ?? "whole");
    return next;
  }

  remove(
    densities: MarkdownSectionDensities,
    index: number,
  ): MarkdownSectionDensities {
    return densities.filter((_, candidate_index) => candidate_index !== index);
  }
}
