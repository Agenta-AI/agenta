/** A quiet "Temporary" pill on a session-cwd file; agent files carry none (`agent-files/` says so). */
import {type FileOrigin} from "@agenta/entities/drive"
import {SimpleTooltip as Tooltip} from "@agenta/ui/ui"

/** The agent accent at 55% — the recent-file left rule. */
export const AGENT_ACCENT_SOFT = "light-dark(rgba(17,57,85,0.55), rgba(140,207,255,0.55))"

export const OriginTag = ({origin}: {origin: FileOrigin}) =>
    origin === "agent" ? null : (
        <Tooltip title="Temporary file — only in this conversation's working folder.">
            <span className="inline-flex shrink-0 cursor-default items-center rounded border border-solid border-colorBorderSecondary px-1 align-middle text-[12px] font-medium leading-[15px] text-colorTextTertiary">
                Temporary
            </span>
        </Tooltip>
    )
