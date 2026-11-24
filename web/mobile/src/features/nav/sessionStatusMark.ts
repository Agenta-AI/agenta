import {createElement, type ReactElement, type ReactNode} from "react"

import {createT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {SimpleTooltip, Spinner} from "@agenta/ui/ui"

const tNow = createT(navigationCatalog)

/** The state a session row marks on its right; null draws nothing. */
export type SessionMark = "running" | "waiting" | "live" | null

export const sessionMarkOf = (session: {
    running?: boolean
    waiting?: boolean
    alive?: boolean
}): SessionMark =>
    session.running ? "running" : session.waiting ? "waiting" : session.alive ? "live" : null

/** A spinner while a turn runs, amber while it waits on you, dark while the session is live. */
export const sessionStatusMark = (mark: SessionMark): ReactNode => {
    if (mark === "running") return createElement(Spinner, {className: "size-3"})
    if (!mark) return null
    const label = tNow(
        mark === "waiting" ? "navigation.items.sessionWaiting" : "navigation.items.sessionLive",
    )
    // COLOR-03: the dot's word shows in a tooltip.
    const dot = createElement("span", {
        role: "img",
        "aria-label": label,
        className: `size-1.5 rounded-round ${mark === "waiting" ? "bg-warning" : "bg-foreground"}`,
    })
    return createElement(SimpleTooltip, {title: label, children: dot})
}

/** A row with no menu (a builder chat, the phone sheet): the title, then the mark on the right. */
export const withStatusMark = (node: ReactNode, status: ReactNode): ReactElement =>
    createElement(
        "span",
        {className: "flex w-full min-w-0 items-center"},
        createElement("span", {className: "min-w-0 flex-1 truncate"}, node),
        status
            ? createElement(
                  "span",
                  // Above the row's stretched link, so the dot's tooltip can open.
                  {className: "relative z-[1] -mr-1 flex w-4 shrink-0 items-center justify-center"},
                  status,
              )
            : null,
    )
