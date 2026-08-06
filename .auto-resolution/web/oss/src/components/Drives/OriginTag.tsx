/**
 * Origin pill for a drive entry: teal "Agent" for the durable per-agent mount (shared across the
 * agent's sessions), a quiet neutral "Session" for the ephemeral session cwd. Shared by every drive
 * surface (rows/cards/tiles and the drawer tree) — only shown when a drive holds both kinds. The
 * tooltip spells out what each scope means (the tags alone don't).
 */
import {Tooltip} from "antd"

import {type FileOrigin} from "./useSessionDrive"

// Agent-teal, matching the config self-commit indicator.
export const AGENT_ACCENT = "var(--ag-c-13C2C2, #13c2c2)"

// Shared so the Files filter tabs (All / Agent / Session) explain the same distinction the tags do.
export const ORIGIN_TIP: Record<FileOrigin, string> = {
    agent: "Agent file — kept across every conversation with this agent.",
    session: "Session file — only in this conversation's working folder.",
}

export const OriginTag = ({origin}: {origin: FileOrigin}) => (
    <Tooltip title={ORIGIN_TIP[origin]}>
        {origin === "agent" ? (
            <span
                className="inline-flex shrink-0 cursor-default items-center rounded px-1 align-middle text-[10px] font-medium leading-[15px]"
                style={{color: AGENT_ACCENT, border: `1px solid ${AGENT_ACCENT}`}}
            >
                Agent
            </span>
        ) : (
            <span className="inline-flex shrink-0 cursor-default items-center rounded border border-solid border-colorBorderSecondary px-1 align-middle text-[10px] font-medium leading-[15px] text-colorTextTertiary">
                Session
            </span>
        )}
    </Tooltip>
)
