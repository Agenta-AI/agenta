import {McpServersSection, type ConfirmDestructive} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

/**
 * The MCP servers tab. The surface itself lives in `@agenta/settings-ui` so the mobile app
 * renders the same one; this supplies the app's own confirmation.
 *
 * The adapter exists because the section names its destructive verb on the button ("Disconnect",
 * not "Yes"), and antd's confirm spells the label and the danger styling differently than the
 * shared `ConfirmDestructive` shape does.
 */
const confirm: ConfirmDestructive = ({title, message, okText, danger, onOk}) =>
    AlertPopup({
        title,
        message,
        onOk,
        ...(okText ? {okText} : {}),
        ...(danger ? {okType: "danger" as const} : {}),
    })

const MCPEndpoints: React.FC = () => <McpServersSection confirm={confirm} />

export default MCPEndpoints
