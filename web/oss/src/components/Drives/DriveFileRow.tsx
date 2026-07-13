/**
 * DriveFileRow — the ONE file-list row shared across every drive surface (chat context rail,
 * config Storage section, Runtime Files card): icon · name · trailing meta, with the "just
 * changed" teal accent. Semantic tokens throughout so it sits correctly on any surface (the
 * config panel's default bg or the elevated context/inspector surface — fill hovers are alpha
 * overlays). One component so the rows align instead of drifting per-surface.
 */
import {type ReactNode} from "react"

import {driveFileIcon} from "./DriveDrawer"

// Agent-teal, matching the config self-commit indicator, for a file that just changed.
const AGENT_ACCENT = "var(--ag-c-13C2C2, #13c2c2)"

export const DriveFileRow = ({
    path,
    label,
    trailing,
    recent,
    onOpen,
}: {
    path: string
    /** Main label; defaults to the basename. Pass the full relative path for the config surfaces. */
    label?: string
    /** Right-aligned meta (size / relative time). */
    trailing?: ReactNode
    /** Highlight as just-changed (teal left accent bar). */
    recent?: boolean
    onOpen: () => void
}) => (
    <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary"
        style={recent ? {boxShadow: `inset 2px 0 0 ${AGENT_ACCENT}`} : undefined}
    >
        <span className="shrink-0">{driveFileIcon(path)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {label ?? path.split("/").pop()}
        </span>
        {trailing != null ? (
            <span className="ml-auto shrink-0 text-[11px] text-colorTextTertiary">{trailing}</span>
        ) : null}
    </button>
)
