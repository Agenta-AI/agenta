import {useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {Trash} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {DeleteProviderModalProps} from "./assets/types"

const DeleteProviderModalContent = dynamic(() => import("./assets/DeleteProviderModalContent"), {
    ssr: false,
})

const DeleteProviderModal = ({selectedProvider, ...props}: DeleteProviderModalProps) => {
    const [isLoading, setIsLoading] = useState(false)
    const {handleDeleteVaultSecret, mutate} = useVaultSecret()

    const onDelete = async () => {
        try {
            setIsLoading(true)
            await handleDeleteVaultSecret(selectedProvider as LlmProvider)

            mutate()
            props.onCancel?.({} as any)
        } catch (error) {
            console.log(error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <EnhancedModal
            title="Are you sure you want to delete?"
            okButtonProps={{icon: <Trash size={14} className="mt-0.5" />, type: "primary"}}
            classNames={{footer: "flex items-center justify-end"}}
            okText="Delete"
            okType="danger"
            onOk={onDelete}
            confirmLoading={isLoading}
            {...props}
        >
            <DeleteProviderModalContent selectedProvider={selectedProvider} />
        </EnhancedModal>
    )
}

export default DeleteProviderModal
