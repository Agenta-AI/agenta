import {workflowRevisionsByWorkflowListDataAtomFamily} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"

import {appsAtom} from "@/oss/state/app"

// ---------------------------------------------------------------------------
// Modal state — minimal: only what can't be derived
// ---------------------------------------------------------------------------

export interface CustomWorkflowModalState {
    open: boolean
    /** null / "" = create mode; non-empty string = configure mode (appId) */
    appId: string | null
    /** Called after a successful create or configure-save */
    onSuccess?: () => Promise<void>
    /** Called to trigger template creation flow (create mode only) */
    onCreateApp?: () => void
}

export const customWorkflowModalStateAtom = atom<CustomWorkflowModalState>({
    open: false,
    appId: null,
})

/** Normalized key used to scope form values: appId or "new-app" */
export const normalizeAppKey = (id?: string | null) => (id && id.trim().length ? id : "new-app")

/** Whether the modal is in configure mode (vs create mode) */
export const customWorkflowModeAtom = atom((get) => {
    const {appId} = get(customWorkflowModalStateAtom)
    return normalizeAppKey(appId) !== "new-app" ? ("configure" as const) : ("create" as const)
})

// ---------------------------------------------------------------------------
// Form values — scoped by appId via atom family
// ---------------------------------------------------------------------------

export interface CustomWorkflowValues {
    appName: string
    appUrl: string
    appDesc: string
}

export const customWorkflowValuesAtomFamily = atomFamily((_appKey: string | null) =>
    atomWithImmer<CustomWorkflowValues>({
        appName: "",
        appUrl: "",
        appDesc: "",
    }),
)

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const openCustomWorkflowModalAtom = atom(
    null,
    (
        get,
        set,
        params: {
            appId?: string | null
            onSuccess?: () => Promise<void>
            onCreateApp?: () => void
        },
    ) => {
        const appKey = normalizeAppKey(params.appId)

        set(customWorkflowModalStateAtom, {
            open: true,
            appId: params.appId ?? null,
            onSuccess: params.onSuccess,
            onCreateApp: params.onCreateApp,
        })

        // Seed form values
        const valuesAtom = customWorkflowValuesAtomFamily(appKey)

        if (appKey !== "new-app") {
            // Configure mode: hydrate from app + latest revision
            const apps = get(appsAtom) as any[]
            const app = Array.isArray(apps) ? apps.find((a: any) => a.id === appKey) : null
            const revisions = get(workflowRevisionsByWorkflowListDataAtomFamily(appKey))
            const first = revisions.length > 0 ? revisions[0] : null
            set(valuesAtom, {
                appName: (app?.name as string) || (app?.slug as string) || "",
                appUrl: (first?.data?.url as string) || "",
                appDesc: "",
            })
        } else {
            // Create mode: empty
            set(valuesAtom, {appName: "", appUrl: "", appDesc: ""})
        }
    },
)

export const closeCustomWorkflowModalAtom = atom(null, (_get, set) => {
    set(customWorkflowModalStateAtom, (prev) => ({...prev, open: false}))
})

// ---------------------------------------------------------------------------
// Ephemeral UI state
// ---------------------------------------------------------------------------

export interface TestConnectionStatus {
    success: boolean
    error: boolean
    loading: boolean
}

export const customWorkflowTestStatusAtom = atom<TestConnectionStatus>({
    success: false,
    error: false,
    loading: false,
})

export const customWorkflowConfiguringAtom = atom<boolean>(false)

// ---------------------------------------------------------------------------
// Backward-compat re-exports (consumed by legacy code paths)
// ---------------------------------------------------------------------------

/** @deprecated Use customWorkflowModalStateAtom instead */
export const customWorkflowModalPropsAtom = customWorkflowModalStateAtom
