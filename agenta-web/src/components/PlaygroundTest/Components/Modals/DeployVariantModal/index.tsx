import {useCallback, useMemo, useState} from "react"
import router from "next/router"
import {message, Modal} from "antd"
import {DeployVariantModalProps} from "./types"
import {Rocket} from "@phosphor-icons/react"
import DeploymentEnviromentTable from "./assets/DeploymentEnviromentTable"
import {usePostHogAg} from "@/lib/helpers/analytics/hooks/usePostHogAg"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {createPublishVariant, useEnvironments} from "@/services/deployment/api"

const DeployVariantModal = ({variantId, ...props}: DeployVariantModalProps) => {
    const {variant} = usePlayground({variantId, hookId: "DeployVariantModal"})
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

                message.success(`Published ${variant?.variantName} to ${envName}`)
                posthog?.capture?.("app_deployed", {app_id: appId, environment: envName})
            })
        } catch (error) {
            message.error("Failed to deploy variants. Please try again")
        } finally {
            setIsLoading(false)
        }
    }, [createPublishVariant])

    const steps = useMemo(
        () => [
            {
                title: "Deploy variant",
                component: (
                    <DeploymentEnviromentTable
                        environments={environments}
                        selectedEnvs={selectedEnvs}
                        setSelectedEnvs={setSelectedEnvs}
                        variantId={variantId}
                        variant={variant}
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
