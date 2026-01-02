import {atom} from "jotai"

interface DeleteVariantModalState {
    open: boolean
    revisionIds: string[]
}

export const deleteVariantModalAtom = atom<DeleteVariantModalState>({open: false, revisionIds: []})

export const openDeleteVariantModalAtom = atom(null, (get, set, revisionIds: string | string[]) => {
    const uniqueIds = Array.from(new Set([revisionIds].flat().filter(Boolean))) as string[]
    set(deleteVariantModalAtom, {open: true, revisionIds: uniqueIds})
})

export const closeDeleteVariantModalAtom = atom(null, (get, set) => {
    set(deleteVariantModalAtom, {open: false, revisionIds: []})
})

export const deleteVariantModalOpenAtom = atom((get) => get(deleteVariantModalAtom).open)
export const deleteVariantModalRevisionIdsAtom = atom(
    (get) => get(deleteVariantModalAtom).revisionIds,
)
