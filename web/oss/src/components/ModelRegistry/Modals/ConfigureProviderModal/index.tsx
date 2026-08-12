import {useEffect, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {message} from "@agenta/ui/app-message"
import {EnhancedModal} from "@agenta/ui/components/modal"
import dynamic from "next/dynamic"

import {ConfigureProviderModalProps} from "./assets/types"

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
                // Only a brand-new connection is named after its provider; an existing one keeps
                // the name it was saved with, which the catalog title would overwrite.
                title: selectedProvider?.id ? undefined : selectedProvider?.title,
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
