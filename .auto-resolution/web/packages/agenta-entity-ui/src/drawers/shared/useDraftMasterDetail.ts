import {useCallback, useEffect, useRef, useState} from "react"

import {DRAFT_PREFIX} from "./MasterDetailRail"

/**
 * Master-detail draft state shared by the schedule + subscription drawers. Owns the
 * selection plus a set of unsaved draft slots (each a persisted form), and keeps the
 * right pane from ever going blank: removing the active item falls back to a remaining
 * draft, then an existing entity, then a fresh draft.
 *
 * `initialId` (e.g. the edit-mode entity id) selects that entity without spawning a
 * draft; absent, the rail opens on one fresh draft. The hook re-initializes whenever
 * `initialId` changes — drawers mount this only while open, so that's once per open.
 */
export function useDraftMasterDetail<T extends {id?: string | null}>({
    initialId,
    entities,
    maxDrafts,
    onDelete,
}: {
    initialId?: string
    entities: T[]
    maxDrafts: number
    /** Perform the delete (API + toast); return whether it succeeded. */
    onDelete: (id: string) => Promise<boolean>
}) {
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
    const [drafts, setDrafts] = useState<string[]>([])
    const [draftNames, setDraftNames] = useState<Record<string, string>>({})
    const draftSeq = useRef(0)

    useEffect(() => {
        if (initialId) {
            setDrafts([])
            setDraftNames({})
            setSelectedId(initialId)
        } else {
            draftSeq.current += 1
            const first = `${DRAFT_PREFIX}${draftSeq.current}`
            setDrafts([first])
            setDraftNames({})
            setSelectedId(first)
        }
    }, [initialId])

    const canCreate = drafts.length < maxDrafts

    const handleNew = useCallback(() => {
        if (drafts.length >= maxDrafts) return
        draftSeq.current += 1
        const id = `${DRAFT_PREFIX}${draftSeq.current}`
        setDrafts((d) => [...d, id])
        setSelectedId(id)
    }, [drafts.length, maxDrafts])

    const setDraftName = useCallback(
        (id: string, name: string) => setDraftNames((n) => ({...n, [id]: name})),
        [],
    )

    // A draft saved → it's now a real entity (the list query is invalidated on create):
    // drop the slot and select the created entity, keeping the drawer open.
    const handleDraftSaved = useCallback((draftId: string, savedId: string) => {
        setDrafts((d) => d.filter((x) => x !== draftId))
        setDraftNames((n) => {
            const next = {...n}
            delete next[draftId]
            return next
        })
        setSelectedId(savedId)
    }, [])

    // Pick a fallback selection so the right pane never goes blank: a remaining draft,
    // else an existing entity (excluding `excludeId`), else a fresh draft.
    const fallbackSelect = useCallback(
        (remainingDrafts: string[], excludeId?: string) => {
            if (remainingDrafts.length) {
                setSelectedId(remainingDrafts[0])
                return
            }
            const fallbackEntity = entities.find((e) => e.id && e.id !== excludeId)?.id
            if (fallbackEntity) {
                setSelectedId(fallbackEntity)
                return
            }
            draftSeq.current += 1
            const fresh = `${DRAFT_PREFIX}${draftSeq.current}`
            setDrafts([fresh])
            setSelectedId(fresh)
        },
        [entities],
    )

    const removeDraft = useCallback(
        (draftId: string) => {
            const remaining = drafts.filter((x) => x !== draftId)
            setDraftNames((n) => {
                const next = {...n}
                delete next[draftId]
                return next
            })
            setDrafts(remaining)
            if (selectedId === draftId) fallbackSelect(remaining)
        },
        [drafts, selectedId, fallbackSelect],
    )

    const deleteEntity = useCallback(
        async (id: string) => {
            const ok = await onDelete(id)
            if (!ok) return
            if (selectedId !== id) return
            fallbackSelect(drafts, id)
        },
        [onDelete, selectedId, drafts, fallbackSelect],
    )

    return {
        selectedId,
        setSelectedId,
        drafts,
        draftNames,
        canCreate,
        handleNew,
        setDraftName,
        handleDraftSaved,
        removeDraft,
        deleteEntity,
    }
}
