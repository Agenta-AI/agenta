import {Atom, atom} from "jotai"

import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

// The shape of the drawer state
export interface VariantDrawerState {
    open: boolean
    id?: string
    variantsSource: Atom<any> | null
}

// Main atom for the drawer state
export const variantDrawerAtom = atom<VariantDrawerState>({
    open: false,
    id: undefined,
    variantsSource: revisionListAtom,
})

// Optional: selectors and reset atom (if you want)
export const isVariantDrawerOpenAtom = atom((get) => get(variantDrawerAtom).open)
export const resetVariantDrawerAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: false, variantsSource: revisionListAtom}),
)
export const openVariantDrawerAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: true, variantsSource: revisionListAtom}),
)
export const openVariantDrawerWithIdAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: true, variantsSource: revisionListAtom, id: ""}),
)
