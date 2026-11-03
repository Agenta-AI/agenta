import {GatewayToolsSection} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

export default function Tools() {
    // AlertPopup is this app's confirm; the section hides its destructive
    // actions on hosts that bring none.
    return <GatewayToolsSection confirm={AlertPopup} />
}
