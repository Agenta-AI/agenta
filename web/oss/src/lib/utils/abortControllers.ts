/**
 * Global registry of all in-flight AbortControllers created by data fetchers.
 * When the user navigates away we call `abortAll()` so underlying HTTP
 * requests are cancelled immediately and database connections are freed.
 */
const controllers = new Set<AbortController>()

/** Create a new controller and register it so it is cancelled on route change. */
export function createAbortSignal(): AbortSignal {
    const controller = new AbortController()
    controllers.add(controller)
    return controller.signal
}

/** Abort every registered controller and clear the registry. */
export function abortAll(): void {
    controllers.forEach((c) => c.abort())
    controllers.clear()
}
