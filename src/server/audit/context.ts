import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is making this request.
 *
 * Carried in async-local storage rather than passed down through every service
 * signature, so the audit extension can stamp a change without each service
 * remembering to hand it the actor — the thing that always gets forgotten.
 */
export interface ActorContext {
  user_id?: string | null;
  customer_id?: string | null;
  role?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
}

/*
 * Parked on `globalThis` on purpose.
 *
 * Next bundles server code more than once — a route handler and a server
 * component do not share a module registry — and its dev server re-evaluates
 * modules on every edit. A module-level store would then exist in several
 * copies, and a write made in one would be invisible to the audit extension
 * reading another: the actor silently became null. One store per process is
 * what this needs, so that is where it lives.
 */
const globalForActor = globalThis as unknown as {
  __actorStorage?: AsyncLocalStorage<ActorContext>;
};

const storage: AsyncLocalStorage<ActorContext> =
  globalForActor.__actorStorage ?? new AsyncLocalStorage<ActorContext>();

globalForActor.__actorStorage = storage;

/**
 * Runs `fn` with this actor in scope; every write inside it is attributed.
 *
 * The callback is awaited *inside* the scope rather than having its promise
 * handed back out. Prisma's promises are lazy — they do not run until
 * something awaits them — so returning one from `storage.run` started the
 * query after the scope had already closed, and the audit row came out with
 * no actor on it. The `async` wrapper keeps the scope open for the whole
 * chain.
 */
export function withActor<T>(actor: ActorContext, fn: () => Promise<T> | T): Promise<T> {
  return storage.run(actor, async () => fn());
}

/** The actor in scope, or an empty context for a system job. */
export function currentActor(): ActorContext {
  return storage.getStore() ?? {};
}

/** The id to stamp on `created_by`: a staff user, else the customer acting. */
export function currentActorId(): string | null {
  const actor = currentActor();
  return actor.user_id ?? actor.customer_id ?? null;
}
