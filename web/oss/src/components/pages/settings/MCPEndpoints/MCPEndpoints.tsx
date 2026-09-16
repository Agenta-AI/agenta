import {McpServersSection} from "@agenta/settings-ui"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"

/**
 * The MCP servers tab. The surface itself lives in `@agenta/settings-ui` so the mobile app
 * renders the same one; this supplies the app's own confirmation.
 */
const MCPEndpoints: React.FC = () => <McpServersSection confirm={AlertPopup} />

export default MCPEndpoints
