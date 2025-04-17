import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {ConfigureProviderModalProps} from "./assets/types"
import {useEffect, useState} from "react"
import {message} from "antd"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"

const ConfigureProviderModalContent = dynamic(
    () => import("./assets/ConfigureProviderModalContent"),
    {ssr: false},
)

const ConfigureProviderModal = ({selectedProvider, ...props}: ConfigureProviderModalProps) => {
    const {handleModifyVaultSecret, mutate} = useVaultSecret()
    const [key, setKey] = useState("")
    const [loadingSecrets, setLoadingSecrets] = useState(false)

    const onCancel = () => {
        props.onCancel?.({} as any)
        setKey("")
    }

    useEffect(() => {
        if (selectedProvider?.key !== undefined) {
            setKey(selectedProvider.key)
        }
    }, [selectedProvider])

    const onUpdateKey = async () => {
        try {
            setLoadingSecrets(true)
            await handleModifyVaultSecret({
                name: selectedProvider?.name,
                id: selectedProvider?.id,
                title: selectedProvider?.title,
                key,
            })

            mutate()
            message.success("The secret is saved")
            onCancel()
        } finally {
            setLoadingSecrets(false)
        }
    }
    return (
        <EnhancedModal
            title={`Configure ${selectedProvider?.title} API key`}
            okText="Confirm"
            okType="primary"
            onOk={onUpdateKey}
            confirmLoading={loadingSecrets}
            onCancel={onCancel}
            afterClose={() => setKey("")}
            {...props}
        >
            <ConfigureProviderModalContent
                selectedProvider={selectedProvider}
                value={key}
                onChange={(e) => setKey(e.target.value)}
            />
        </EnhancedModal>
    )
}

export default ConfigureProviderModal
