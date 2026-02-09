import {variantsListAtomFamily} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"

import {CustomWorkflowModalProps} from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/types"
import {appsAtom, currentAppAtom, selectedAppIdAtom} from "@/oss/state/app"

// Centralized state for the Custom Workflow Modal
export const customWorkflowModalPropsAtom = atom<CustomWorkflowModalProps>({
    customWorkflowAppValues: {appName: "", appUrl: "", appDesc: ""},
    setCustomWorkflowAppValues: () => {},
    handleCreateApp: () => {},
    configureWorkflow: false,
    variants: [],
    allVariantsDataMutate: undefined,
    appNameExist: false,
    mutate: async () => {},
    open: false,
    onCancel: () => {},
})

// Dedicated atom for live form values used inside the modal content
export interface CustomWorkflowValues {
    appName: string
    appUrl: string
    appDesc: string
}
// Family of form atoms keyed by appId ("configure" mode when appId is provided; otherwise "create" mode)
export const customWorkflowValuesAtomFamily = atomFamily((appId: string | null) =>
    atomWithImmer<CustomWorkflowValues>({
        appName: "",
        appUrl: "",
        appDesc: "",
    }),
)

// Seed values from current app and first variant
export const customWorkflowSeedAtom = atom((get) => {
    const app: any = get(currentAppAtom)
    const appId = get(selectedAppIdAtom)
    const vars = appId ? get(variantsListAtomFamily(appId)) : []
    const first = Array.isArray(vars) && vars.length > 0 ? vars[0] : null
    return {
        appName: (app?.app_name as string) || "",
        appUrl: (first?.uri as string) || "",
        appDesc: "",
    } satisfies CustomWorkflowValues
})

export const setCustomWorkflowModalPropsAtom = atom(
    null,
    (get, set, props: Partial<CustomWorkflowModalProps>) => {
        const prev = get(customWorkflowModalPropsAtom)
        set(customWorkflowModalPropsAtom, {...prev, ...props})
    },
)

export const openCustomWorkflowModalAtom = atom(
    null,
    (get, set, props?: Partial<CustomWorkflowModalProps>) => {
        const prev = get(customWorkflowModalPropsAtom)
        // Normalize key: null/undefined/"" => "new-app" (create mode)
        const normalizeKey = (id?: string) => (id && id.trim().length ? id : "new-app")
        // Preferred signal is appId; fallback inference by currentApp presence (deprecated)
        const appKeyFromProps = normalizeKey(props?.appId as any)
        const inferredConfigure =
            props?.appId !== undefined
                ? appKeyFromProps !== "new-app"
                : (props?.configureWorkflow ?? Boolean(get(currentAppAtom)))
        const next = {
            ...prev,
            ...(props || {}),
            configureWorkflow: inferredConfigure,
            open: true,
        }
        set(customWorkflowModalPropsAtom, next)
        // Seed the atom family instance for this modal by normalized key
        const appKey = appKeyFromProps
        const valuesAtom = customWorkflowValuesAtomFamily(appKey)
        // Explicit values take precedence ONLY if non-empty
        const v = props?.customWorkflowAppValues
        const hasExplicit = v && Boolean((v.appName || v.appUrl || v.appDesc || "").trim())
        if (hasExplicit && v) {
            set(valuesAtom, v as any)
            return
        }

        if (appKey !== "new-app") {
            // Configure: hydrate from specific app id
            const apps = get(appsAtom) as any[]
            const app = Array.isArray(apps) ? apps.find((a) => a.app_id === appKey) : null
            const providedVars: any[] = (props?.variants as any[]) || []
            const entityVars = get(variantsListAtomFamily(appKey))
            const globalVars: any[] = Array.isArray(entityVars) ? entityVars : []
            const vars = providedVars.length ? providedVars : globalVars
            const first = Array.isArray(vars) && vars.length > 0 ? (vars[0] as any) : null
            set(valuesAtom, {
                appName: (app?.app_name as string) || "",
                appUrl: (first?.uri as string) || "",
                appDesc: "",
            })
        } else {
            // Create: empty state
            set(valuesAtom, {appName: "", appUrl: "", appDesc: ""})
        }
    },
)

export const closeCustomWorkflowModalAtom = atom(null, (get, set) => {
    const prev = get(customWorkflowModalPropsAtom)
    set(customWorkflowModalPropsAtom, {...prev, open: false})
})

// Ephemeral UI state atoms for the modal
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
