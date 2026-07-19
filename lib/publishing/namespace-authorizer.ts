import type { NamespaceRepository } from "../namespace/interfaces.ts";
import type {
  PublishActor,
  PublishAuthorization,
  PublishingAuthorizer,
} from "./interfaces.ts";

/**
 * DA-NAMESPACE authorization over the reservation store:
 *
 * | Namespace  | Guest    | Owner   | Other authenticated |
 * | ---------- | -------- | ------- | ------------------- |
 * | unreserved | allowed  | allowed | allowed             |
 * | reserved   | rejected | allowed | rejected            |
 *
 * Reservation lookup is case-insensitive via the repository contract, so a
 * reserved namespace protects every casing of itself.
 */
export class NamespacePublishingAuthorizer implements PublishingAuthorizer {
  #reservations: NamespaceRepository;

  constructor(reservations: NamespaceRepository) {
    this.#reservations = reservations;
  }

  async authorize(
    actor: PublishActor,
    namespace: string,
  ): Promise<PublishAuthorization> {
    const reservation = await this.#reservations.find(namespace);
    if (reservation === null) return { allowed: true };
    if (actor.kind === "user" && actor.user_id === reservation.owner_user_id) {
      return { allowed: true };
    }
    return { allowed: false, reason: "namespace_reserved" };
  }
}
