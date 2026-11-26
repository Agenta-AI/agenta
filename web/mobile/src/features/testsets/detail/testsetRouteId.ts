/** The route id of a test set that is not saved yet. */
export const NEW_TESTSET_ROUTE_ID = "new"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether a route id can name a test set page: a revision id (a UUID) or `new`.
 * Any other value is a page that does not exist. The old app drew an empty editor for it.
 */
export const isTestsetRouteId = (id: string): boolean =>
    id === NEW_TESTSET_ROUTE_ID || UUID.test(id)

/** The test set page of one revision. */
export const testsetRevisionPath = (base: string, revisionId: string): string =>
    `${base}/testsets/${revisionId}`
