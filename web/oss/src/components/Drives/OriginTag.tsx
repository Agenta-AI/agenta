/**
 * Origin pill for a drive entry: teal "Agent" for the durable per-agent mount (shared across the
 * agent's sessions), a quiet neutral "Session" for the ephemeral session cwd. Shared by every drive
 * surface (rows/cards/tiles and the drawer tree) — only shown when a drive holds both kinds.
 */
import {type FileOrigin} from "./useSessionDrive"

// Agent-teal, matching the config self-commit indicator.
export const AGENT_ACCENT = "var(--ag-c-13C2C2, #13c2c2)"

export const OriginTag = ({origin}: {origin: FileOrigin}) =>
    origin === "agent" ? (
        <span
            className="inline-flex shrink-0 items-center rounded px-1 align-middle text-[10px] font-medium leading-[15px]"
            style={{color: AGENT_ACCENT, border: `1px solid ${AGENT_ACCENT}`}}
        >
            Agent
        </span>
    ) : (
        <span className="inline-flex shrink-0 items-center rounded border border-solid border-colorBorderSecondary px-1 align-middle text-[10px] font-medium leading-[15px] text-colorTextTertiary">
            Session
        </span>
    )
