import {Atom, atom} from "jotai"

import {playgroundRevisionListAtom} from "@/oss/components/Playground/state/atoms/variants"

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
    variantsSource: playgroundRevisionListAtom,
})

// Optional: selectors and reset atom (if you want)
export const isVariantDrawerOpenAtom = atom((get) => get(variantDrawerAtom).open)
export const resetVariantDrawerAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: false, variantsSource: playgroundRevisionListAtom}),
)
export const openVariantDrawerAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: true, variantsSource: playgroundRevisionListAtom}),
)
export const openVariantDrawerWithIdAtom = atom(null, (get, set) =>
    set(variantDrawerAtom, {open: true, variantsSource: playgroundRevisionListAtom, id: ""}),
)
