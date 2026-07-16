import type {LevelQueryState} from "../utilities"

export type AutoSelectLatestChildDecision<T> =
    {status: "wait"} | {status: "select"; child: T} | {status: "complete"}

interface ResolveAutoSelectLatestChildOptions<T> {
    children: T[]
    query: LevelQueryState
    getId: (child: T) => string
    disabledChildIds?: Set<string>
}

/**
 * Resolve the next auto-selection action independently from React effects.
 *
 * @internal
 */
export function resolveAutoSelectLatestChild<T>({
    children,
    query,
    getId,
    disabledChildIds,
}: ResolveAutoSelectLatestChildOptions<T>): AutoSelectLatestChildDecision<T> {
    if (query.isPending) return {status: "wait"}

    const firstChild = children.find((child) => !disabledChildIds?.has(getId(child)))
    if (firstChild) return {status: "select", child: firstChild}

    // Legacy adapters may omit isFetched. Only an explicit false means the
    // initial empty snapshot is still waiting for the lazy query to settle.
    if (!query.isError && query.isFetched === false && children.length === 0) {
        return {status: "wait"}
    }

    return {status: "complete"}
}
