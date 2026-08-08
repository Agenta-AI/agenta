/**
 * Moved to the chat package so mobile shares the identical always-allow behavior; this path
 * survives as a re-export for the app-layer call sites.
 */
export {useAlwaysAllowTool, type ToolGrantInfo} from "@agenta/chat/hooks"
