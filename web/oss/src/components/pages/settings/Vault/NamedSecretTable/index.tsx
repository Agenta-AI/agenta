import {NamedSecretTable} from "@agenta/settings-ui"

import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"

import ConfigureSecretModal from "../ConfigureSecretModal"

/** OSS binding: the shared vault table with this app's secret + provider dialogs. */
const OssNamedSecretTable = () => (
    <NamedSecretTable
        renderConfigureDialog={({selectedSecret, open, onClose}) => (
            <ConfigureSecretModal open={open} selectedSecret={selectedSecret} onCancel={onClose} />
        )}
        renderDeleteDialog={({selectedProvider, open, onClose}) => (
            <DeleteProviderModal
                open={open}
                selectedProvider={selectedProvider}
                onCancel={onClose}
            />
        )}
    />
)

export default OssNamedSecretTable
