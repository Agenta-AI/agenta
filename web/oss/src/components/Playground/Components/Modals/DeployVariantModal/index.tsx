import {useCallback, useEffect} from "react"

import {message} from "@agenta/ui/app-message"
import {Rocket} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import router from "next/router"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

import {
    deploySelectedEnvAtom,
    deployResetAtom,
    deploySubmitAtom,
    deployVariantModalAtom,
} from "./store/deployVariantModalStore"
import {DeployVariantModalProps} from "./types"

const DeployVariantModalContent = dynamic(() => import("./assets/DeployVariantModalContent"), {
    ssr: false,
})

const DeployVariantModal = ({
    parentVariantId,
    variantId,
    revisionId,
    variantName,
    revision,
    mutate,
    isLoading: propsIsLoading,
    ...props
}: DeployVariantModalProps) => {
    const posthog = usePostHogAg()
    const selectedEnvName = useAtomValue(deploySelectedEnvAtom)
    const resetDeploy = useSetAtom(deployResetAtom)
    const submitDeploy = useSetAtom(deploySubmitAtom)
    const setModalState = useSetAtom(deployVariantModalAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const {isPending: isLoading} = useAtomValue(publishMutationAtom)

    const appId = router.query.app_id as string

    // Ensure Jotai store has the necessary identifiers when this modal is used directly
    useEffect(() => {
        const next = {
            parentVariantId: parentVariantId ?? variantId ?? null,
            revisionId: revisionId ?? null,
            variantName,
            revision,
            mutate,
        }
        setModalState((prev) => ({...prev, ...next}))
    }, [parentVariantId, variantId, revisionId, variantName, revision, mutate, setModalState])

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
        resetDeploy()
    }, [resetDeploy, props])

    const deployVariants = useCallback(async () => {
        // Ensure latest props are in the store before submitting
        const next = {
            parentVariantId: parentVariantId ?? variantId ?? null,
            revisionId: revisionId ?? null,
            variantName,
            revision,
            mutate,
        }
        console.debug("[DeployModal] pre-submit sync", next)
        setModalState((prev) => ({...prev, ...next}))

        const result = await submitDeploy({
            parentVariantId: next.parentVariantId,
            revisionId: next.revisionId,
        })
        if (!result?.ok) {
            if (result?.error) message.error(result.error)
            return
        }
        const env = result.env as string
        onClose()
        message.success(`Published ${variantName} to ${env}`)
        posthog?.capture?.("app_deployed", {app_id: appId, environment: env})
        recordWidgetEvent("variant_deployed")
    }, [submitDeploy, onClose, variantName, appId, posthog, recordWidgetEvent])

    return (
        <EnhancedModal
            centered
            destroyOnHidden
            okText="Deploy"
            onCancel={onClose}
            confirmLoading={isLoading}
            title="Deploy variant"
            onOk={() => deployVariants()}
            okButtonProps={{
                icon: <Rocket size={14} className="mt-0.5" />,
                disabled: !selectedEnvName.length,
                "data-tour": "deploy-variant-modal-deploy-button",
            }}
            cancelButtonProps={{
                "data-tour": "deploy-variant-modal-cancel-button",
            }}
            classNames={{footer: "flex items-center justify-end"}}
            afterClose={() => onClose()}
            {...props}
        >
            <DeployVariantModalContent
                variantName={variantName}
                revision={revision}
                isLoading={propsIsLoading || isLoading}
            />
        </EnhancedModal>
    )
}

export default DeployVariantModal
