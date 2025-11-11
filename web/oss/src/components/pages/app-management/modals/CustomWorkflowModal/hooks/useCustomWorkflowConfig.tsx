import {useCallback, useEffect, useMemo, useState} from "react"

import {useAppsData} from "@/oss/contexts/app.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {removeTrailingSlash} from "@/oss/lib/shared/variant"
import {createAndStartTemplate, ServiceType} from "@/oss/services/app-selector/api"

import CustomWorkflowModal from ".."

import {useCustomWorkflowConfigProps} from "./types"

const useCustomWorkflowConfig = ({
    setFetchingTemplate,
    setStatusData,
    setStatusModalOpen,
    configureWorkflow = true,
    afterConfigSave,
}: useCustomWorkflowConfigProps) => {
    const {currentApp, apps} = useAppsData()
    const {secrets} = useVaultSecret()
    const [isCustomWorkflowModalOpen, setIsCustomWorkflowModalOpen] = useState(false)
    const [customWorkflowAppValues, setCustomWorkflowAppValues] = useState(() => ({
        appName: "",
        appUrl: "",
        appDesc: "",
    }))

    const {mutate} = useAppsData()
    // @ts-ignore
    const {data, mutate: variantsMutate} = useVariants(currentApp)(
        {
            appId: currentApp?.app_id,
        },
        [],
    )

    const posthog = usePostHogAg()

    const variant = useMemo(() => data?.variants?.[0], [data?.variants])
    const {user} = useProfileData()

    useEffect(() => {
        if (!configureWorkflow) return

        if (variant) {
            setCustomWorkflowAppValues({
                appName: currentApp?.app_name ?? "",
                appUrl: variant?.uri ?? "",
                appDesc: "",
            })
        }
    }, [variant, currentApp, configureWorkflow])

    const handleCustomWorkflowClick = async () => {
        if (!setFetchingTemplate || !setStatusData || !setStatusModalOpen) return

        setIsCustomWorkflowModalOpen(false)
        // warn the user and redirect if openAI key is not present
        // TODO: must be changed for multiples LLM keys
        // if (redirectIfNoLLMKeys()) return

        setFetchingTemplate(true)
        setStatusModalOpen(true)

        // attempt to create and start the template, notify user of the progress
        const apiKeys = secrets
        await createAndStartTemplate({
            isCustomWorkflow: true,
            appName: customWorkflowAppValues.appName,
            templateKey: ServiceType.Custom,
            serviceUrl: removeTrailingSlash(customWorkflowAppValues.appUrl),
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

    const appNameExist = useMemo(
        () =>
            apps.some(
                (app) =>
                    app.app_name.toLowerCase() === customWorkflowAppValues.appName.toLowerCase(),
            ),
        [apps, customWorkflowAppValues.appName],
    )

    const Modal = useMemo(() => {
        return (
            <CustomWorkflowModal
                open={isCustomWorkflowModalOpen}
                onCancel={() => {
                    setIsCustomWorkflowModalOpen(false)
                    if (!configureWorkflow) {
                        setCustomWorkflowAppValues({
                            appName: "",
                            appUrl: "",
                            appDesc: "",
                        })
                    }
                }}
                customWorkflowAppValues={customWorkflowAppValues}
                setCustomWorkflowAppValues={setCustomWorkflowAppValues}
                handleCreateApp={configureWorkflow ? () => {} : handleCustomWorkflowClick}
                configureWorkflow={configureWorkflow}
                // @ts-ignore
                allVariantsDataMutate={variantsMutate}
                variants={data?.variants}
                mutate={async () => afterConfigSave}
                {...(!configureWorkflow && {appNameExist})}
            />
        )
    }, [
        isCustomWorkflowModalOpen,
        customWorkflowAppValues,
        data?.variants,
        configureWorkflow,
        setCustomWorkflowAppValues,
        handleCustomWorkflowClick,
        variantsMutate,
        afterConfigSave,
    ])

    const openModal = useCallback(() => {
        setIsCustomWorkflowModalOpen(true)
    }, [])

    return {
        CustomWorkflowModal: Modal,
        openModal,
    }
}

export default useCustomWorkflowConfig
