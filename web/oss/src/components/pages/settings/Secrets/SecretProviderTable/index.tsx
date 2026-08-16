import {SecretProviderTable} from "@agenta/settings-ui"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import ConfigureProviderModal from "@/oss/components/ModelRegistry/Modals/ConfigureProviderModal"
import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"

/** OSS binding: the shared provider table with this app's model-registry dialogs. */
const OssSecretProviderTable = ({type}: {type: "standard" | "custom"}) => (
    <SecretProviderTable
        type={type}
        renderDeleteDialog={({selectedProvider, open, onClose}) => (
            <DeleteProviderModal
                open={open}
                selectedProvider={selectedProvider}
                onCancel={onClose}
            />
        )}
        renderConfigureDialog={({selectedProvider, open, onClose}) => (
            <ConfigureProviderModal
                open={open}
                selectedProvider={selectedProvider}
                onCancel={onClose}
            />
        )}
        renderConfigureDrawer={({selectedProvider, open, onClose}) => (
            <ConfigureProviderDrawer
                open={open}
                selectedProvider={selectedProvider}
                onClose={onClose}
            />
        )}
    />
)

export default OssSecretProviderTable
