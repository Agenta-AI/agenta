import type {RefObject} from "react"

import {useT} from "@agenta/i18n"
import sessionsRowsCatalog from "@agenta/i18n/catalogs/sessions.rows"

import type {InlineRename} from "./useInlineRename"

/**
 * The input a session row swaps its title for while renaming.
 *
 * One component so the rail, the sessions list and the mobile list cannot drift on the keys:
 * Enter saves, Escape abandons, blur saves (a click elsewhere reads as "done", not "discard").
 */
const InlineRenameInput = ({
    rename,
    ariaLabel,
    className,
    inputRef,
}: {
    rename: InlineRename
    /** What the field is called. Names the entity being renamed, not the control. */
    ariaLabel?: string
    className?: string
    /** For a host that has to re-claim focus after the input mounts (see the nav rail). */
    inputRef?: RefObject<HTMLInputElement | null>
}) => {
    const t = useT(sessionsRowsCatalog)
    return (
        <input
            ref={inputRef}
            autoFocus
            value={rename.draft}
            aria-label={ariaLabel ?? t("sessions.rows.sessionName")}
            onChange={(event) => rename.setDraft(event.target.value)}
            onBlur={() => void rename.commit()}
            onKeyDown={(event) => {
                if (event.key === "Enter") void rename.commit()
                if (event.key === "Escape") rename.cancel()
            }}
            className={
                className ??
                "h-5 w-full min-w-0 rounded border border-solid border-colorBorder bg-colorBgContainer px-1 text-[13px] leading-5 text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
            }
        />
    )
}

export default InlineRenameInput
