export interface RandomIndexSource {
  pick(max_exclusive: number): number;
}

/** Generates a route-oriented name while avoiding caller-known candidates. */
export interface RandomNameGenerator {
  generate(used_names?: ReadonlySet<string>): string;
}

/** Runtime-neutral cryptographic random source. */
export class CryptoRandomIndexSource implements RandomIndexSource {
  pick(max_exclusive: number): number {
    if (!Number.isSafeInteger(max_exclusive) || max_exclusive < 1) {
      throw new Error("max_exclusive must be a positive safe integer");
    }

    const range = 2 ** 32;
    const limit = range - (range % max_exclusive);
    const values = new Uint32Array(1);
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % max_exclusive;
  }
}

const word_dimensions = [
  ["big", "mini", "short", "small", "tall", "tiny"],
  ["blue", "gold", "gray", "green", "pink", "red", "teal", "white"],
  ["bold", "calm", "glad", "jolly", "keen", "kind", "shy", "wise"],
  ["bear", "duck", "fox", "hare", "moth", "owl", "seal", "wolf"],
] as const;

/**
 * Produces size-color-mood-animal slugs. If a generated combination is already
 * known to the caller, a numeric suffix preserves the four-word base.
 */
export class FourWordRandomNameGenerator implements RandomNameGenerator {
  #random: RandomIndexSource;

  constructor(random: RandomIndexSource = new CryptoRandomIndexSource()) {
    this.#random = random;
  }

  generate(used_names: ReadonlySet<string> = new Set()): string {
    const base = word_dimensions.map((words) =>
      words[this.#random.pick(words.length)]
    ).join("-");
    if (!used_names.has(base)) return base;

    let suffix = 2;
    while (used_names.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }
}
