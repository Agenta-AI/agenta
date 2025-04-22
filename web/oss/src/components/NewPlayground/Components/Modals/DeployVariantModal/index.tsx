import {useCallback, useState} from "react"

import {Rocket} from "@phosphor-icons/react"
import dynamic from "next/dynamic"
import router from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {createPublishVariant, createPublishRevision} from "@/oss/services/deployment/api"

import {DeployVariantModalProps} from "./types"

const DeployVariantModalContent = dynamic(() => import("./assets/DeployVariantModalContent"), {
    ssr: false,
})

const DeployVariantModal = ({
    variantId,
    environments,
    revisionId,
    variantName,
    revision,
    mutate,
    isLoading: propsIsLoading,
    ...props
}: DeployVariantModalProps) => {
    const posthog = usePostHogAg()

    const [selectedEnvName, setSelectedEnvName] = useState<string[]>([])
    const [note, setNote] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    const appId = router.query.app_id as string

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
        setSelectedEnvName([])
        setNote("")
    }, [])

    const deployVariants = useCallback(async () => {
        const selectEnv = selectedEnvName[0]
        try {
            setIsLoading(true)

            if (variantId) {
                await createPublishVariant({
                    note,
                    variant_id: variantId,
                    environment_name: selectEnv,
                })
            } else {
                await createPublishRevision({
                    note,
                    revision_id: revisionId,
                    environment_ref: selectEnv,
                })
            }

            onClose()
            mutate?.()

            message.success(`Published ${variantName} to ${selectEnv}`)
            posthog?.capture?.("app_deployed", {app_id: appId, environment: selectEnv})
        } catch (error) {
            message.error("Failed to deploy variants. Please try again")
        } finally {
            setIsLoading(false)
        }
    }, [createPublishVariant, revision, revisionId, variantId, selectedEnvName, note])

    return (
        <EnhancedModal
            centered
            destroyOnClose
            okText="Deploy"
            onCancel={onClose}
            confirmLoading={isLoading}
            title="Deploy variant"
            onOk={() => deployVariants()}
            okButtonProps={{
                icon: <Rocket size={14} className="mt-0.5" />,
                disabled: !selectedEnvName.length,
            }}
            classNames={{footer: "flex items-center justify-end"}}
            afterClose={() => onClose()}
            {...props}
        >
            <DeployVariantModalContent
                environments={environments}
                selectedEnvName={selectedEnvName}
                setSelectedEnvName={setSelectedEnvName}
                variantName={variantName}
                revision={revision}
                isLoading={propsIsLoading || isLoading}
                note={note}
                setNote={setNote}
            />
        </EnhancedModal>
    )
}

export default DeployVariantModal
