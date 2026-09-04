import {GatewayToolsSection} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

export default function Tools() {
    return (
        <div className="flex flex-col gap-8">
            {/* AlertPopup is this app's confirm; the section hides its destructive
                actions on hosts that bring none. */}
            <GatewayToolsSection confirm={AlertPopup} />
        </div>
    )
}
