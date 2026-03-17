import {useCallback} from "react"

import {removeTrailingSlash} from "@agenta/shared/utils"
import {useQueryClient} from "@tanstack/react-query"
import {useSetAtom, useStore} from "jotai"

import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {createAppWithTemplate, ServiceType} from "@/oss/services/app-selector/api"
import {useAppsData} from "@/oss/state/app"
import {appCreationStatusAtom} from "@/oss/state/appCreation/status"
import {
    normalizeAppKey,
    openCustomWorkflowModalAtom,
    closeCustomWorkflowModalAtom,
    customWorkflowValuesAtomFamily,
} from "@/oss/state/customWorkflow/modalAtoms"
import {useProfileData} from "@/oss/state/profile"

import {useCustomWorkflowConfigProps} from "./types"

const useCustomWorkflowConfig = ({
    setFetchingTemplate,
    setStatusModalOpen,
    appId: propsAppId,
    folderId,
    afterConfigSave,
}: useCustomWorkflowConfigProps) => {
    const {currentApp, mutate} = useAppsData()
    const {secrets} = useVaultSecret()
    const rawAppId = propsAppId ?? currentApp?.id ?? ""
    const modalAtomKey = normalizeAppKey(rawAppId)
    const configureWorkflow = modalAtomKey !== "new-app"

    const queryClient = useQueryClient()
    const posthog = usePostHogAg()
    const {user} = useProfileData()

    const openModalAtom = useSetAtom(openCustomWorkflowModalAtom)
    const closeModalAtom = useSetAtom(closeCustomWorkflowModalAtom)
    const jotaiStore = useStore()
    const setStatusData = useSetAtom(appCreationStatusAtom)

    const handleCustomWorkflowClick = async () => {
        if (!setFetchingTemplate || !setStatusModalOpen) return
        const latestValues = jotaiStore.get(customWorkflowValuesAtomFamily(modalAtomKey))
        closeModalAtom()

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        const apiKeys = secrets
        await createAppWithTemplate({
            isCustomWorkflow: true,
            appName: latestValues.appName,
            templateKey: ServiceType.Custom,
            serviceUrl: removeTrailingSlash(latestValues.appUrl),
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            folderId,
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

                setStatusData((prev) => ({...prev, status, details, appId: appId || prev.appId}))
            },
        })
    }

    const onSuccess = useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["variants"]})
        await afterConfigSave?.()
    }, [queryClient, afterConfigSave])

    const openModal = useCallback(() => {
        openModalAtom({
            appId: modalAtomKey,
            onSuccess,
            onCreateApp: configureWorkflow ? undefined : handleCustomWorkflowClick,
        })
    }, [openModalAtom, configureWorkflow, modalAtomKey, handleCustomWorkflowClick, onSuccess])

    return {
        openModal,
    }
}

export default useCustomWorkflowConfig
