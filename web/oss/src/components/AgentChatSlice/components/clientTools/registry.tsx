/** Desktop-only client-tool overrides that require OSS settings surfaces. */
import {registerChatSkin} from "@agenta/chat/skin"
import {ConnectToolWidget} from "@agenta/entity-ui/clientTools"
import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"

import GatewayConnectToolWidget from "./GatewayConnectToolWidget"
import {parseGatewayTarget} from "./useGatewayConnectFlow"

const GatewayAwareConnectToolWidget = ({meta, settle}: ClientToolWidgetProps) => {
    const target = parseGatewayTarget(meta.input)
    if (target) return <GatewayConnectToolWidget target={target} meta={meta} settle={settle} />
    return <ConnectToolWidget meta={meta} settle={settle} />
}

registerChatSkin({
    clientTools: {
        byRenderKind: {connect: GatewayAwareConnectToolWidget},
        byToolName: {request_connection: GatewayAwareConnectToolWidget},
    },
})
