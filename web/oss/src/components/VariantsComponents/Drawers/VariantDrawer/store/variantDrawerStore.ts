import {
    workflowRevisionsByWorkflowListDataAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {atom, Atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

type DrawerVariant = Workflow
type DrawerType = "variant" | "deployment"

interface Revert {
    isDisabled?: boolean
    onClick: () => void
    isLoading: boolean
}

interface VariantDrawerState {
    open: boolean
    type: DrawerType
    variantsAtom?: Atom<DrawerVariant[] | null>
    revert?: Revert
    selectedVariantId?: string
}

// Main drawer state atom
export const variantDrawerAtom = atomWithImmer<VariantDrawerState>({
    open: false,
    type: "variant",
    variantsAtom: undefined,
    revert: undefined,
    selectedVariantId: undefined,
})

// Action to open the drawer
export const openVariantDrawerAtom = atom(
    null,
    (
        get,
        set,
        params: {
            type: DrawerType
            variantsAtom?: Atom<DrawerVariant[] | null>
            revert?: Revert
            selectedVariantId?: string
        },
    ) => {
        set(variantDrawerAtom, (draft) => {
            draft.open = true
            draft.type = params.type
            draft.variantsAtom = params.variantsAtom
            draft.revert = params.revert
            draft.selectedVariantId = params.selectedVariantId
        })
    },
)

// Action to close the drawer
export const closeVariantDrawerAtom = atom(null, (get, set) => {
    // Only toggle open flag off; keep the rest to avoid re-open race
    set(variantDrawerAtom, (draft) => {
        draft.open = false
    })
})

// Action to fully clear drawer state (used on unmount)
export const clearVariantDrawerAtom = atom(null, (_get, set) => {
    set(variantDrawerAtom, (draft) => {
        draft.open = false
        draft.type = "variant"
        draft.variantsAtom = undefined
        draft.revert = undefined
        draft.selectedVariantId = undefined
    })
})

// Action to update only the selected revision inside the open drawer
export const setVariantDrawerSelectedIdAtom = atom(null, (_get, set, newId: string | undefined) => {
    set(variantDrawerAtom, (draft) => {
        draft.selectedVariantId = newId
    })
})

// Computed atom to get the variants list (either from custom atom or default)
export const variantDrawerVariantsAtom = atom((get) => {
    const drawerState = get(variantDrawerAtom)
    // Don't fetch revision data when the drawer is closed
    if (!drawerState.open) return []
    if (drawerState.variantsAtom) {
        return get(drawerState.variantsAtom)
    }
    const rawAppId = get(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null
    return appId ? get(workflowRevisionsByWorkflowListDataAtomFamily(appId)) : []
})

// Id of the revision to display in the drawer (single-source for Drawer selection)
export const drawerVariantIdAtom = atom<string | null>(null)

// One-time guard to initialize drawer state from URL only on initial load
export const drawerInitializedFromUrlAtom = atom<boolean>(false)
