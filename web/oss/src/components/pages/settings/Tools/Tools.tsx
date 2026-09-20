import {GatewayToolsSection} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

import ComposioProjectKey from "./ComposioProjectKey"

export default function Tools() {
    return (
        <div className="flex flex-col gap-8">
            {/* The key belongs beside the integrations it authorizes. On the MCP tab it sat above
                rows it says nothing about, reading "Not connected" over a connected server. */}
            <ComposioProjectKey />
            {/* AlertPopup is this app's confirm; the section hides its destructive
                actions on hosts that bring none. */}
            <GatewayToolsSection confirm={AlertPopup} />
        </div>
    )
}
