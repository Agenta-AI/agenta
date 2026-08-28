import type {ReactElement, ReactNode} from "react"

import type {ListQueryState} from "@agenta/entities/shared"
import type {Atom, WritableAtom} from "jotai"

/** Entity kind for icon/tone selection. Mirrors oss ReferenceTone — keep the literals in sync. */
export type SidebarEntityKind =
    | "app"
    | "variant"
    | "testset"
    | "query"
    | "evaluator"
    | "environment"

/**
 * Minimal shape every dynamic entity row needs. Entity types from
 * `@agenta/entities` (Workflow, Testset, …) are structurally assignable to this.
 */
export interface SidebarEntityRef {
    id: string
    name?: string | null
    slug?: string | null
}

/**
 * Gated source state for one entity group.
 * - `idle`    group is closed → not fetched (the gate keeps the query unsubscribed)
 * - `loading` group is open and the backing query is pending
 * - `error`   the backing query failed
 * - `ready`   data is available (may still be empty)
 */
export interface SidebarEntitySource<TRef extends SidebarEntityRef = SidebarEntityRef> {
    status: "idle" | "loading" | "error" | "ready"
    refs: TRef[]
    error?: unknown
    /** Headings the rows sit under, in render order. Absent for an ungrouped entity. */
    groups?: SidebarEntityGroup[]
    /** Keys of groups whose rows are folded away. */
    collapsedKeys?: string[]
    /** Overrides the entity's static `emptyLabel` — e.g. "nothing matches these filters". */
    emptyLabel?: string
}

/** One heading in a grouped entity list. */
export interface SidebarEntityGroup {
    key: string
    label: string
}

/**
 * Author-facing config — this is all you write to add an entity to the registry.
 * Paths are project-relative; the resolver prefixes them with the active `projectURL`.
 */
export interface SidebarEntityConfig<TRef extends SidebarEntityRef = SidebarEntityRef> {
    /** Reference tone → icon (matches the entity chips in the TraceDrawer). */
    kind: SidebarEntityKind
    /** Optional icon override for entity kinds without a reference tone. */
    icon?: ReactNode
    /** Existing `@agenta/entities` list atom. Use `fromParts` if only query+data atoms exist. */
    listAtom: Atom<ListQueryState<TRef>>
    /** Row label, e.g. `(ref) => ref.name ?? ref.slug`. */
    getLabel: (ref: TRef) => string
    /** Project-relative detail path, e.g. `(ref) => `/testsets/${ref.id}``. */
    childPath: (ref: TRef) => string
    /** Prefixes the row is highlighted on; empty opts it out. Defaults to `[childPath]`. */
    childMatchPaths?: (ref: TRef) => string[]
    /** Shown (muted, disabled) when the group is open but has no items. */
    emptyLabel?: string
    /** Cap on rendered rows; overflow adds a "Show all" row. Defaults to 3. */
    maxItems?: number
    /** Project-relative path for the "Show all" overflow row. */
    showAllPath?: string
    /** Per-row icon, overriding the shared kind icon — for rows whose state differs from each
     * other (a session's liveness dot, say), where one icon for the whole group says nothing. */
    getIcon?: (ref: TRef) => ReactElement
    /** Optional row tooltip for context not shown by the label. */
    getTooltip?: (ref: TRef) => string | undefined
    /** Per-row classes, for state the label cannot carry (an archived session fades). */
    getRowClassName?: (ref: TRef) => string | undefined
    /** Extra work on click, alongside following `childPath` — e.g. handing the target to the
     * surface being navigated to. Runs in the default jotai store, not a hook. */
    getOnClick?: (ref: TRef) => () => void
    /** Wraps the rendered row so an entity can add per-row chrome (a kebab menu, a right-click
     * menu). Returns an ELEMENT, so the wrapper component — not this closure — owns the hooks. */
    wrapRow?: (ref: TRef, node: ReactNode) => ReactElement
    /** Which heading a row belongs under. Omit and the entity renders an ungrouped flat list. */
    getGroupKey?: (ref: TRef) => string
    /** Heading order and collapse state. Required alongside `getGroupKey`. */
    groupsAtom?: Atom<{
        groups: SidebarEntityGroup[]
        collapsedKeys: string[]
        emptyLabel?: string
    }>
    /** Toggles a heading's collapse state. */
    toggleGroupAtom?: WritableAtom<string[], [string], void>
    /** `ref.id -> last used, in ms`. Ranked rows lead newest-first; the rest keep source order. */
    ranksAtom?: Atom<ReadonlyMap<string, number>>
}

/**
 * Resolved adapter produced by `defineSidebarEntity`. Ref type is erased to
 * `SidebarEntityRef` so the registry can hold heterogeneous entities in one record
 * without variance friction; the typed config closures are preserved inside.
 */
export interface SidebarEntity {
    parentKey: string
    kind: SidebarEntityKind
    icon?: ReactNode
    activeSourceAtom: Atom<SidebarEntitySource>
    getLabel: (ref: SidebarEntityRef) => string
    childLink: (ref: SidebarEntityRef, projectURL: string) => string
    childMatchLinks?: (ref: SidebarEntityRef, projectURL: string) => string[]
    emptyLabel?: string
    maxItems: number
    showAllLink?: (projectURL: string) => string
    getIcon?: (ref: SidebarEntityRef) => ReactElement
    getTooltip?: (ref: SidebarEntityRef) => string | undefined
    getRowClassName?: (ref: SidebarEntityRef) => string | undefined
    getOnClick?: (ref: SidebarEntityRef) => () => void
    wrapRow?: (ref: SidebarEntityRef, node: ReactNode) => ReactElement
    getGroupKey?: (ref: SidebarEntityRef) => string
    ranksAtom?: Atom<ReadonlyMap<string, number>>
    groupsAtom?: Atom<{
        groups: SidebarEntityGroup[]
        collapsedKeys: string[]
        emptyLabel?: string
    }>
    toggleGroupAtom?: WritableAtom<string[], [string], void>
}
