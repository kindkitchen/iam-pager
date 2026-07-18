import type {
  IdGenerator,
  Session,
  SessionCredential,
  SessionResolver,
  SessionTransport,
} from "./session/mod.ts";

const response_context_key: unique symbol = Symbol("response_context");

interface ResponseContext {
  readonly credential_to_set?: SessionCredential;
}

/** Canonical server-owned context available to every application route. */
export interface AppRequestContext {
  readonly request_id: string;
  readonly session: Session;
}

/** Fresh state populated before application route handling begins. */
export interface AppRequestState {
  request_context: AppRequestContext;
  [response_context_key]?: ResponseContext;
}

/** Minimal request pipeline boundary; Fresh Context satisfies this interface. */
export interface RequestPipelineContext {
  readonly req: Request;
  readonly state: AppRequestState;
  next(): Promise<Response>;
}

export interface RequestContextHandler {
  handle(context: RequestPipelineContext): Promise<Response>;
  decorate(state: AppRequestState, response: Response): Response;
}

export interface RequestContextMiddlewareOptions {
  readonly session_resolver: SessionResolver;
  readonly session_transport: SessionTransport;
  readonly request_id_generator: IdGenerator;
}

/** Resolves typed request state without making Fresh the source of the logic. */
export class RequestContextMiddleware implements RequestContextHandler {
  readonly #session_resolver: SessionResolver;
  readonly #session_transport: SessionTransport;
  readonly #request_id_generator: IdGenerator;

  constructor(options: RequestContextMiddlewareOptions) {
    this.#session_resolver = options.session_resolver;
    this.#session_transport = options.session_transport;
    this.#request_id_generator = options.request_id_generator;
  }

  async handle(context: RequestPipelineContext): Promise<Response> {
    const request_id = this.#request_id_generator.generate();
    if (request_id.length === 0) {
      throw new Error("request ID generator must not return an empty value");
    }

    const resolution = await this.#session_resolver.resolve(
      this.#session_transport.extract(context.req),
    );
    context.state.request_context = {
      request_id,
      session: resolution.session,
    };
    context.state[response_context_key] = {
      credential_to_set: resolution.credential_to_set,
    };

    // The route is called exactly once. Fresh's root error route calls
    // decorate separately when next() throws past this middleware.
    return this.decorate(context.state, await context.next());
  }

  /**
   * Change only the response envelope. This is shared with the Fresh error
   * boundary so framework-generated failures receive the same diagnostics.
   */
  decorate(state: AppRequestState, response: Response): Response {
    let decorated = with_request_id(
      response,
      state.request_context.request_id,
    );
    const response_context = state[response_context_key];
    if (response_context?.credential_to_set !== undefined) {
      decorated = this.#session_transport.attach(
        decorated,
        response_context.credential_to_set,
      );
      delete state[response_context_key];
    }
    return decorated;
  }
}

function with_request_id(response: Response, request_id: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", request_id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
