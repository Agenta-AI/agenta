import {useCallback, useMemo, useState} from "react"
import dynamic from "next/dynamic"
import {Modal} from "antd"
import {DeployVariantModalProps} from "./types"
import {Rocket} from "@phosphor-icons/react"
import DeploymentEnviromentTable from "./assets/DeploymentEnviromentTable"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
const ConfirmDeploymentNote = dynamic(() => import("./assets/ConfirmDeploymentNote"), {ssr: false})

const DeployVariantModal: React.FC<DeployVariantModalProps> = ({
    variantId,
    environments,
    ...props
}) => {
    const {variant} = usePlayground({variantId, hookId: "DeployVariantModal"})
    const [selectedEnvs, setSelectedEnvs] = useState<string[]>([])
    const [note, setNote] = useState("")
    const [current, setCurrent] = useState(0)

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    const steps = useMemo(
        () => [
            {
                title: "Deploy variant",
                onClick: () => setCurrent(1),
                component: (
                    <DeploymentEnviromentTable
                        // environments={}
                        selectedEnvs={selectedEnvs}
                        setSelectedEnvs={setSelectedEnvs}
                        variantId={variantId}
                        variant={variant}
                    />
                ),
            },
            {
                title: "Confirm deployment",
                onClick: () => {},
                component: <ConfirmDeploymentNote value={note} setValue={setNote} />,
            },
        ],
        [current],
    )

    return (
        <Modal
            centered
            destroyOnClose
            okText="Deploy"
            onCancel={onClose}
            title={steps[current]?.title}
            afterClose={() => setCurrent(0)}
            onOk={steps[current]?.onClick}
            okButtonProps={{icon: <Rocket size={14} />, disabled: !selectedEnvs.length}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">{steps[current]?.component}</section>
        </Modal>
    )
}

export default DeployVariantModal
