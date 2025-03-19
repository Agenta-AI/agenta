import {useEffect, useMemo, useState} from "react"

import {useRouter} from "next/router"

import {useAppsData} from "@/oss/contexts/app.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useAllVariantsData} from "@/oss/lib/hooks/useAllVariantsData"
import {removeTrailingSlash} from "@/oss/lib/hooks/useStatelessVariant/assets/helpers"
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
    const router = useRouter()
    const {currentApp, apps} = useAppsData()
    const appId = router.query.app_id as string
    const {secrets} = useVaultSecret()
    const [isCustomWorkflowModalOpen, setIsCustomWorkflowModalOpen] = useState(false)
    const [customWorkflowAppValues, setCustomWorkflowAppValues] = useState(() => ({
        appName: "",
        appUrl: "",
        appDesc: "",
    }))

    const {mutate} = useAppsData()
    const {mutate: allVariantsDataMutate, data: variants} = useAllVariantsData({appId})
    const posthog = usePostHogAg()

    const variant = useMemo(() => variants?.[0], [variants])
    const {user} = useProfileData()

    useEffect(() => {
        if (variant) {
            setCustomWorkflowAppValues({
                appName: currentApp?.app_name ?? "",
                appUrl: variant?.uri ?? "",
                appDesc: "",
            })
        }
    }, [variant, currentApp])

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

    const Modal = useMemo(
        () => (
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
                allVariantsDataMutate={allVariantsDataMutate}
                variants={variants}
                mutate={async () => afterConfigSave}
                {...(!configureWorkflow && {appNameExist})}
            />
        ),
        [
            isCustomWorkflowModalOpen,
            customWorkflowAppValues,
            variants,
            configureWorkflow,
            setCustomWorkflowAppValues,
            handleCustomWorkflowClick,
            allVariantsDataMutate,
        ],
    )

    return {
        CustomWorkflowModal: Modal,
        openModal: () => setIsCustomWorkflowModalOpen(true),
    }
}

export default useCustomWorkflowConfig
