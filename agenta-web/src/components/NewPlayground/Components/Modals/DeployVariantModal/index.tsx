import {useCallback, useMemo, useState} from "react"

import {Modal} from "antd"
import router from "next/router"
import {Rocket} from "@phosphor-icons/react"

import {usePostHogAg} from "@/lib/helpers/analytics/hooks/usePostHogAg"
import {createPublishVariant} from "@/services/deployment/api"

import {message} from "../../../state/messageContext"
import usePlayground from "../../../hooks/usePlayground"

import DeploymentEnvironmentTable from "./assets/DeploymentEnvironmentTable"

import {DeployVariantModalProps} from "./types"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types/transformedVariant"
import {useEnvironments} from "@/services/deployment/hooks/useEnvironments"

const DeployVariantModal = ({variantId, ...props}: DeployVariantModalProps) => {
    const {variantName, revision} = usePlayground({
        variantId,
        hookId: "DeployVariantModal",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {variantName: variant.variantName, revision: variant.revision}
        }, []),
    })
    const {environments, mutate, isEnvironmentsLoading} = useEnvironments()
    const posthog = usePostHogAg()

    const [selectedEnvs, setSelectedEnvs] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [current, setCurrent] = useState(0)

    const appId = router.query.app_id as string

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
        setSelectedEnvs([])
    }, [])

    const deployVariants = useCallback(async () => {
        try {
            setIsLoading(true)

            selectedEnvs.forEach(async (envName) => {
                await createPublishVariant(variantId, envName)
                onClose()
                mutate()

                message.success(`Published ${variantName} to ${envName}`)
                posthog?.capture?.("app_deployed", {app_id: appId, environment: envName})
            })
        } catch (error) {
            message.error("Failed to deploy variants. Please try again")
        } finally {
            setIsLoading(false)
        }
    }, [createPublishVariant, selectedEnvs])

    const steps = useMemo(
        () => [
            {
                title: "Deploy variant",
                component: (
                    <DeploymentEnvironmentTable
                        environments={environments}
                        selectedEnvs={selectedEnvs}
                        setSelectedEnvs={setSelectedEnvs}
                        variantId={variantId}
                        variantName={variantName}
                        revision={revision}
                        isLoading={isEnvironmentsLoading}
                    />
                ),
            },
        ],
        [current, environments],
    )

    return (
        <Modal
            centered
            destroyOnClose
            okText="Deploy"
            onCancel={onClose}
            confirmLoading={isLoading}
            title={steps[current]?.title}
            afterClose={() => setCurrent(0)}
            onOk={() => deployVariants()}
            okButtonProps={{icon: <Rocket size={14} />, disabled: !selectedEnvs.length}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">{steps[current]?.component}</section>
        </Modal>
    )
}

export default DeployVariantModal
