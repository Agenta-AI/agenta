import type {ReactNode} from "react"

import type {ListQueryState} from "@agenta/entities/shared"
import type {Atom} from "jotai"

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
    /** Shown (muted, disabled) when the group is open but has no items. */
    emptyLabel?: string
    /** Cap on rendered rows; overflow adds a "Show all" row. Defaults to 3. */
    maxItems?: number
    /** Project-relative path for the "Show all" overflow row. */
    showAllPath?: string
    /** Per-row icon, overriding the shared kind icon — for rows whose state differs from each
     * other (a session's liveness dot, say), where one icon for the whole group says nothing. */
    getIcon?: (ref: TRef) => ReactNode
    /** Group heading a row belongs under, or null for none. Consecutive rows sharing a label
     * render beneath one disabled header. Refs must already be ordered by group; this inserts
     * headings, it does not sort. */
    getGroup?: (ref: TRef) => string | null
    /** Extra work on click, alongside following `childPath` — e.g. handing the target to the
     * surface being navigated to. Runs in the default jotai store, not a hook. */
    getOnClick?: (ref: TRef) => () => void
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
    emptyLabel?: string
    maxItems: number
    showAllLink?: (projectURL: string) => string
    getIcon?: (ref: SidebarEntityRef) => ReactNode
    getGroup?: (ref: SidebarEntityRef) => string | null
    getOnClick?: (ref: SidebarEntityRef) => () => void
}
