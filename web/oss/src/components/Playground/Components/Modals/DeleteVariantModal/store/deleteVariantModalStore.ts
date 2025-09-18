import {atom} from "jotai"

interface DeleteVariantModalState {
    open: boolean
    variantId?: string
}

export const deleteVariantModalAtom = atom<DeleteVariantModalState>({open: false})

export const openDeleteVariantModalAtom = atom(null, (get, set, variantId: string) => {
    set(deleteVariantModalAtom, {open: true, variantId})
})

export const closeDeleteVariantModalAtom = atom(null, (get, set) => {
    set(deleteVariantModalAtom, {open: false, variantId: undefined})
})

export const deleteVariantModalOpenAtom = atom((get) => get(deleteVariantModalAtom).open)
export const deleteVariantModalVariantIdAtom = atom((get) => get(deleteVariantModalAtom).variantId)
