/**
 * ChangedPathsContext
 *
 * Carries "which config properties have uncommitted changes" — as dot-paths like
 * `harness.permissions.allow` / `runner.permissions.default` / `sandbox.kind` — down to the rail
 * rows that render them. A drawer can then mark the exact property row that changed and open the
 * sub-section that holds it, without prop-drilling a path map through a large render.
 *
 * Deliberately structural and dependency-free: it knows nothing about the agent template or the
 * commit-diff classifier, so this shared drawer primitive stays usable by any config surface. The
 * agent panel's `SectionChanges` (see `SchemaControls/agentTemplate/sectionChanges.ts`) satisfies
 * `ChangedPaths` by shape and can be passed straight in.
 *
 * With no provider, nothing is marked — every existing caller keeps working untouched.
 */
import {createContext, useContext, useMemo, type ReactNode} from "react"

export interface ChangedPaths {
    /** Whether this exact property path changed. */
    isChanged: (path: string) => boolean
    /** Whether anything under this dotted subtree changed. */
    hasChangedUnder: (prefix: string) => boolean
    /** Changed paths under a subtree (all of them with no prefix) — the input to a scoped revert. */
    pathsUnder: (prefix?: string) => string[]
    /**
     * What this property changed FROM — so a row can answer "changed, but from what?" without the
     * reader opening a commit diff. Pre-formatted display strings (the classifier already renders
     * them); `before: undefined` means the committed config had no value for it.
     */
    changeFor?: (path: string) => {before?: string; after?: string} | undefined
    /**
     * Restore these paths to their committed values. Supplied by the HOST, because where the write
     * lands differs by surface: inside a section drawer it must go through that drawer's scoped
     * draft (so Cancel/Save still mean what they say), while the panel writes the entity draft
     * directly. Absent = the surface offers no revert, and the affordance stays hidden.
     */
    revert?: (paths: string[]) => void
}

const NONE: ChangedPaths = {
    isChanged: () => false,
    hasChangedUnder: () => false,
    pathsUnder: () => [],
}

const ChangedPathsContext = createContext<ChangedPaths>(NONE)

export function ChangedPathsProvider({
    changes,
    children,
}: {
    changes: ChangedPaths
    children: ReactNode
}) {
    return <ChangedPathsContext.Provider value={changes}>{children}</ChangedPathsContext.Provider>
}

/** Whether this exact property path has an uncommitted change (marks one rail row). */
export function useChangedPath(path: string | undefined): boolean {
    const changes = useContext(ChangedPathsContext)
    return useMemo(() => (path ? changes.isChanged(path) : false), [changes, path])
}

/**
 * What this property changed from → to, when the surface can say. Null when it's unchanged, so a
 * caller can render the row's "changed" affordance and its explanation from one lookup.
 */
export function useChangedDetail(
    path: string | undefined,
): {before?: string; after?: string} | null {
    const changes = useContext(ChangedPathsContext)
    return useMemo(() => {
        if (!path || !changes.isChanged(path)) return null
        return changes.changeFor?.(path) ?? null
    }, [changes, path])
}

/**
 * Revert ONE property, for a key-scoped undo on its row. Null when the path is unchanged or the
 * surface offers no revert, so the caller renders a plain marker instead of an action.
 */
export function useRevertPath(path: string | undefined): (() => void) | null {
    const changes = useContext(ChangedPathsContext)
    return useMemo(() => {
        const {revert, isChanged} = changes
        if (!revert || !path || !isChanged(path)) return null
        return () => revert([path])
    }, [changes, path])
}

/** Whether anything under this dotted subtree changed — drives a sub-section's `defaultOpen`. */
export function useHasChangedUnder(prefix: string | undefined): boolean {
    const changes = useContext(ChangedPathsContext)
    return useMemo(() => (prefix ? changes.hasChangedUnder(prefix) : false), [changes, prefix])
}

/**
 * Revert a subtree, for a section-scoped "undo these changes" action. Returns null when the surface
 * offers no revert or the subtree is unchanged, so the caller renders nothing.
 */
export function useRevertUnder(prefix: string | undefined): (() => void) | null {
    const changes = useContext(ChangedPathsContext)
    return useMemo(() => {
        const {revert, pathsUnder} = changes
        if (!revert || !prefix) return null
        const paths = pathsUnder(prefix)
        return paths.length ? () => revert(paths) : null
    }, [changes, prefix])
}
