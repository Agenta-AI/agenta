import {atom} from "jotai"

interface DeleteVariantModalState {
    open: boolean
    revisionIds: string[]
    forceVariantIds: string[]
}

export interface OpenDeleteVariantModalPayload {
    revisionIds: string | string[]
    forceVariantIds?: string[]
}

export const deleteVariantModalAtom = atom<DeleteVariantModalState>({
    open: false,
    revisionIds: [],
    forceVariantIds: [],
})

export const openDeleteVariantModalAtom = atom(
    null,
    (get, set, payloadOrRevisionIds: string | string[] | OpenDeleteVariantModalPayload) => {
        const payload =
            typeof payloadOrRevisionIds === "object" && "revisionIds" in payloadOrRevisionIds
                ? payloadOrRevisionIds
                : {revisionIds: payloadOrRevisionIds}
        const uniqueRevisionIds = Array.from(
            new Set([payload.revisionIds].flat().filter(Boolean)),
        ) as string[]
        const uniqueForceVariantIds = Array.from(
            new Set((payload.forceVariantIds || []).filter(Boolean)),
        ) as string[]

        set(deleteVariantModalAtom, {
            open: true,
            revisionIds: uniqueRevisionIds,
            forceVariantIds: uniqueForceVariantIds,
        })
    },
)

export const closeDeleteVariantModalAtom = atom(null, (get, set) => {
    set(deleteVariantModalAtom, {open: false, revisionIds: [], forceVariantIds: []})
})

export const deleteVariantModalOpenAtom = atom((get) => get(deleteVariantModalAtom).open)
export const deleteVariantModalRevisionIdsAtom = atom(
    (get) => get(deleteVariantModalAtom).revisionIds,
)
export const deleteVariantModalForceVariantIdsAtom = atom(
    (get) => get(deleteVariantModalAtom).forceVariantIds,
)
