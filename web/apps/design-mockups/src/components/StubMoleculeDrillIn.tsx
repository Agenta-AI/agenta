/**
 * StubMoleculeDrillIn — mounts the package-tier MoleculeDrillInView from
 * `@agenta/entity-ui/drill-in` against a hand-crafted adapter backed by local
 * Jotai atoms. No OSS state graph, no API.
 *
 * This is the "Tier 1 + Tier 2" mount path:
 *   - DrillInContent + DrillInFieldHeader from @agenta/ui/drill-in (Tier 1)
 *   - MoleculeDrillInView + slot system from @agenta/entity-ui/drill-in (Tier 2)
 *
 * Side-by-side with /gap-04-shape-preservation (which mounts the OSS-tier
 * EntityDualViewEditor), this lets us see the same testcase rendered through
 * the future-proof package pipeline vs. today's OSS pipeline.
 */

import {useMemo, useRef} from "react"

import {MoleculeDrillInView} from "@agenta/entity-ui/drill-in"
import type {DataPath} from "@agenta/shared/utils"
import {atom, useAtomValue} from "jotai"
import type {Atom, WritableAtom} from "jotai"
import {atomFamily} from "jotai/utils"

interface Entity {
    data: Record<string, unknown>
}

interface AdapterShape {
    atoms: {
        data: (id: string) => Atom<Entity | null>
        draft: (id: string) => Atom<Partial<Entity> | null>
        isDirty: (id: string) => Atom<boolean>
    }
    reducers: {
        update: WritableAtom<unknown, [id: string, changes: Partial<Entity>], void>
        discard: WritableAtom<unknown, [id: string], void>
    }
    drillIn: {
        getRootData: (entity: Entity | null) => unknown
        getChangesFromRoot: (
            entity: Entity | null,
            rootData: unknown,
            path: DataPath,
        ) => Partial<Entity> | null
        valueMode?: "structured" | "string"
    }
}

interface StubMoleculeDrillInProps {
    entityId: string
    initialData: Record<string, unknown>
    rootTitle?: string
    editable?: boolean
}

export function StubMoleculeDrillIn({
    entityId,
    initialData,
    rootTitle = "data",
    editable = true,
}: StubMoleculeDrillInProps) {
    // One adapter instance per mount. The atoms are kept in a closure so the
    // family entries are stable across renders.
    const adapterRef = useRef<AdapterShape | null>(null)

    if (!adapterRef.current) {
        // Per-id base store — primitive map of id → entity. Writes update
        // dependent atoms via the family pattern.
        const initialState = new Map<string, Entity>()
        initialState.set(entityId, {data: {...initialData}})
        const stateAtom = atom(initialState)

        const dataFamily = atomFamily((id: string) =>
            atom((get) => get(stateAtom).get(id) ?? null),
        )
        const draftFamily = atomFamily((id: string) =>
            atom<Partial<Entity> | null>((get) => {
                const entity = get(stateAtom).get(id)
                return entity ? {data: {...entity.data}} : null
            }),
        )
        const isDirtyFamily = atomFamily(() => atom(false))

        const updateAtom = atom(
            null,
            (get, set, id: string, changes: Partial<Entity>) => {
                const next = new Map(get(stateAtom))
                const prev = next.get(id)
                if (changes.data && prev) {
                    next.set(id, {...prev, data: {...prev.data, ...changes.data}})
                } else if (changes.data) {
                    next.set(id, {data: {...changes.data}})
                }
                set(stateAtom, next)
            },
        ) as WritableAtom<unknown, [string, Partial<Entity>], void>

        const discardAtom = atom(null, () => {
            // No-op for the stub — there's no draft layer separate from data.
        }) as WritableAtom<unknown, [string], void>

        adapterRef.current = {
            atoms: {
                data: dataFamily,
                draft: draftFamily,
                isDirty: isDirtyFamily,
            },
            reducers: {
                update: updateAtom,
                discard: discardAtom,
            },
            drillIn: {
                valueMode: "structured",
                getRootData: (entity) => entity?.data ?? null,
                getChangesFromRoot: (_entity, rootData) => ({
                    data: (rootData as Record<string, unknown>) ?? {},
                }),
            },
        }
    }

    const adapter = useMemo(() => adapterRef.current!, [])

    // Subscribe so the page re-renders when the data changes (otherwise the
    // breadcrumb/path can read stale state).
    useAtomValue(adapter.atoms.data(entityId))

    return (
        <MoleculeDrillInView
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            molecule={adapter as any}
            entityId={entityId}
            rootTitle={rootTitle}
            editable={editable}
            showBreadcrumb
            showBackArrow
        />
    )
}

export default StubMoleculeDrillIn
