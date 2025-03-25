import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {ConfigureProviderModalProps} from "./assets/types"

const ConfigureProviderModalContent = dynamic(
    () => import("./assets/ConfigureProviderModalContent"),
    {
        ssr: false,
    },
)

const ConfigureProviderModal = ({providerName, ...props}: ConfigureProviderModalProps) => {
    return (
        <EnhancedModal
            title={`Configure ${providerName} API key`}
            okText="Confirm"
            okType="primary"
            {...props}
        >
            <ConfigureProviderModalContent providerName={providerName} />
        </EnhancedModal>
    )
}

export default ConfigureProviderModal
