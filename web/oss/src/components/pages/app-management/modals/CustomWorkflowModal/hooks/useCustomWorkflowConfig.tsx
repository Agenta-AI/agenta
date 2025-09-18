import {useCallback} from "react"

import {useSetAtom, useStore} from "jotai"

import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {removeTrailingSlash} from "@/oss/lib/shared/variant"
import {createAndStartTemplate, ServiceType} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"
import {
    openCustomWorkflowModalAtom,
    closeCustomWorkflowModalAtom,
} from "@/oss/state/customWorkflow/modalAtoms"
import {customWorkflowValuesAtomFamily} from "@/oss/state/customWorkflow/modalAtoms"
import {useProfileData} from "@/oss/state/profile"

import {useCustomWorkflowConfigProps} from "./types"

const useCustomWorkflowConfig = ({
    setFetchingTemplate,
    setStatusData,
    setStatusModalOpen,
    // configureWorkflow = true,
    appId: propsAppId,
    afterConfigSave,
}: useCustomWorkflowConfigProps) => {
    const {currentApp} = useAppsData()
    const {secrets} = useVaultSecret()
    // Read current form values directly from the atom family (scoped by appId for configure mode)
    const rawAppId = propsAppId ?? (currentApp as any)?.app_id ?? ""
    const modalAtomKey = rawAppId && String(rawAppId).trim().length ? String(rawAppId) : "new-app"
    const configureWorkflow = modalAtomKey !== "new-app"

    const {mutate} = useAppsData()
    // @ts-ignore
    const {data, mutate: variantsMutate} = useVariants(currentApp)

    const posthog = usePostHogAg()

    // No local seeding based on first variant here; hydration is centralized
    const {user} = useProfileData()

    const openModalAtom = useSetAtom(openCustomWorkflowModalAtom)
    const closeModalAtom = useSetAtom(closeCustomWorkflowModalAtom)
    const jotaiStore = useStore()

    // Hydration of initial values is handled centrally in openCustomWorkflowModalAtom

    const handleCustomWorkflowClick = async () => {
        if (!setFetchingTemplate || !setStatusData || !setStatusModalOpen) return
        const latestValues = jotaiStore.get(customWorkflowValuesAtomFamily(modalAtomKey))
        closeModalAtom()

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        // attempt to create and start the template, notify user of the progress
        const apiKeys = secrets
        await createAndStartTemplate({
            isCustomWorkflow: true,
            appName: latestValues.appName,
            templateKey: ServiceType.Custom,
            serviceUrl: removeTrailingSlash(latestValues.appUrl),
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            onStatusChange: async (status, details, appId) => {
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    setFetchingTemplate(false)
                if (status === "success") {
                    await mutate()
                    posthog?.capture?.("app_deployment", {
                        properties: {
                            app_id: appId,
                            environment: "UI",
                            deployed_by: user?.id,
                        },
                    })
                }

                setStatusData((prev) => ({status, details, appId: appId || prev.appId}))
            },
        })
    }

    // appNameExist moved to modal content for both modes

    const openModal = useCallback(() => {
        openModalAtom({
            open: true,
            onCancel: () => {
                closeModalAtom()
            },
            handleCreateApp: configureWorkflow ? () => {} : handleCustomWorkflowClick,
            configureWorkflow,
            appId: modalAtomKey,
            // @ts-ignore
            allVariantsDataMutate: variantsMutate,
            variants:
                (Array.isArray((data as any)?.variants) && (data as any)?.variants) ||
                (Array.isArray(data as any) ? (data as any) : []),
            mutate: async () => afterConfigSave?.(),
        })
    }, [
        openModalAtom,
        closeModalAtom,
        configureWorkflow,
        (currentApp as any)?.app_id,
        modalAtomKey,
        handleCustomWorkflowClick,
        variantsMutate,
        data?.variants,
        afterConfigSave,
    ])

    return {
        openModal,
    }
}

export default useCustomWorkflowConfig
