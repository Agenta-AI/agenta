/**
 * Origin pill for a drive entry: a quiet "Temporary" on a file of the ephemeral session cwd —
 * the durable per-agent mount (shared across the agent's sessions) is the default and carries no
 * tag, the `agent-files/` fold already says so. Shared by every drive surface (rows / cards /
 * tiles and the tree) — only shown when a drive holds both kinds. The tooltip spells out what the
 * scope means (the tag alone doesn't).
 */
import {type FileOrigin} from "@agenta/entities/drive"
import {SimpleTooltip as Tooltip} from "@agenta/ui/ui"

/** The agent accent at 55% — the recent-file left rule. */
export const AGENT_ACCENT_SOFT = "light-dark(rgba(17,57,85,0.55), rgba(140,207,255,0.55))"

// Shared so the Files filter tabs (All / Agent / Session) explain the same distinction the tags do.
export const ORIGIN_TIP: Record<FileOrigin, string> = {
    agent: "Agent file — kept across every conversation with this agent.",
    session: "Temporary file — only in this conversation's working folder.",
}

export const OriginTag = ({origin}: {origin: FileOrigin}) =>
    origin === "agent" ? null : (
        <Tooltip title={ORIGIN_TIP[origin]}>
            <span className="inline-flex shrink-0 cursor-default items-center rounded border border-solid border-colorBorderSecondary px-1 align-middle text-[12px] font-medium leading-[15px] text-colorTextTertiary">
                Temporary
            </span>
        </Tooltip>
    )
