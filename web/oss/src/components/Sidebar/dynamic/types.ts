import type {ListQueryState} from "@agenta/entities/shared"
import type {Atom} from "jotai"

import type {ReferenceTone} from "@/oss/components/References"

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
 * - `ready`   data is available (may still be empty)
 */
export interface SidebarEntitySource<TRef extends SidebarEntityRef = SidebarEntityRef> {
    status: "idle" | "loading" | "ready"
    refs: TRef[]
}

/**
 * Author-facing config — this is all you write to add an entity to the registry.
 * Paths are project-relative; the resolver prefixes them with the active `projectURL`.
 */
export interface SidebarEntityConfig<TRef extends SidebarEntityRef = SidebarEntityRef> {
    /** Reference tone → icon (matches the entity chips in the TraceDrawer). */
    kind: ReferenceTone
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
}

/**
 * Resolved adapter produced by `defineSidebarEntity`. Ref type is erased to
 * `SidebarEntityRef` so the registry can hold heterogeneous entities in one record
 * without variance friction; the typed config closures are preserved inside.
 */
export interface SidebarEntity {
    parentKey: string
    kind: ReferenceTone
    activeSourceAtom: Atom<SidebarEntitySource>
    getLabel: (ref: SidebarEntityRef) => string
    childLink: (ref: SidebarEntityRef, projectURL: string) => string
    emptyLabel?: string
    maxItems: number
    showAllLink?: (projectURL: string) => string
}
