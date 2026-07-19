import type { NamespaceRepository } from "../namespace/interfaces.ts";
import type {
  NamespaceAuthority,
  NamespaceAuthorityResolver,
  PageActor,
} from "./interfaces.ts";

/**
 * Resolves namespace authority without exposing the reservation owner. The
 * namespace repository owns case-insensitive identity, so every locator casing
 * receives the same answer.
 */
export class RepositoryNamespaceAuthorityResolver
  implements NamespaceAuthorityResolver {
  readonly #repository: NamespaceRepository;

  constructor(repository: NamespaceRepository) {
    this.#repository = repository;
  }

  async resolve(
    actor: PageActor,
    namespace: string,
  ): Promise<NamespaceAuthority> {
    const reservation = await this.#repository.find(namespace);
    if (reservation === null) return { kind: "unreserved" };
    if (
      actor.kind === "user" && actor.user_id === reservation.owner_user_id
    ) {
      return { kind: "owned" };
    }
    return { kind: "reserved_by_other" };
  }
}
