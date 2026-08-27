import {TriggerConnectionsSection} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

/** OSS binding: the shared connections table with this app's confirm dialog. */
export default function GatewayTriggersSection() {
    return <TriggerConnectionsSection confirm={AlertPopup} />
}
