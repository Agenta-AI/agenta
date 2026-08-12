/**
 * Origin pill for a drive entry: an "Agent" tag for the durable per-agent mount (shared across the
 * agent's sessions), a quiet neutral "Session" for the ephemeral session cwd. Shared by every drive
 * surface (rows/cards/tiles and the drawer tree) — only shown when a drive holds both kinds. The
 * tooltip spells out what each scope means (the tags alone don't).
 */
import {Tooltip} from "antd"

import {type FileOrigin} from "./useSessionDrive"

// Agent accent (recolor spec): deep info ink in light, the approved #8CCFFF in dark. `light-dark()`
// resolves off the root's color-scheme, which ThemeContextProvider keeps in sync with the theme.
export const AGENT_ACCENT = "light-dark(#113955, #8CCFFF)"
/** Tag well behind the accent — the dark pair is founder-approved verbatim. */
export const AGENT_ACCENT_BG = "light-dark(#E5F1F9, rgba(140,207,255,0.14))"
/** Same accent at 55% — the recent-file left rule. */
export const AGENT_ACCENT_SOFT = "light-dark(rgba(17,57,85,0.55), rgba(140,207,255,0.55))"

// Shared so the Files filter tabs (All / Agent / Session) explain the same distinction the tags do.
export const ORIGIN_TIP: Record<FileOrigin, string> = {
    agent: "Agent file — kept across every conversation with this agent.",
    session: "Session file — only in this conversation's working folder.",
}

export const OriginTag = ({origin}: {origin: FileOrigin}) => (
    <Tooltip title={ORIGIN_TIP[origin]}>
        {origin === "agent" ? (
            <span
                className="inline-flex shrink-0 cursor-default items-center rounded px-1 align-middle text-[12px] font-medium leading-[15px]"
                style={{color: AGENT_ACCENT, background: AGENT_ACCENT_BG}}
            >
                Agent
            </span>
        ) : (
            <span className="inline-flex shrink-0 cursor-default items-center rounded border border-solid border-colorBorderSecondary px-1 align-middle text-[12px] font-medium leading-[15px] text-colorTextTertiary">
                Session
            </span>
        )}
    </Tooltip>
)
