import {WebhooksPage} from "@agenta/settings-ui"

import DeleteWebhookModal from "@/oss/components/Webhooks/Modals/DeleteWebhookModal"
import SecretRevealModal from "@/oss/components/Webhooks/Modals/SecretRevealModal"
import WebhookDrawer from "@/oss/components/Webhooks/WebhookDrawer"

/** OSS binding: the shared webhooks table with this app's drawer and dialogs. */
const Webhooks = () => (
    <WebhooksPage
        renderDrawer={({onSuccess}) => <WebhookDrawer onSuccess={onSuccess} />}
        renderDeleteDialog={() => <DeleteWebhookModal />}
        renderSecretReveal={() => <SecretRevealModal />}
    />
)

export default Webhooks
