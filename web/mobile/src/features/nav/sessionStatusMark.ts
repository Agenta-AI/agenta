import {createElement, type ReactElement, type ReactNode} from "react"

import {createT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {Spinner} from "@agenta/ui/ui"

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
    if (mark === "running") return createElement(Spinner, {className: "size-2.5"})
    if (!mark) return null
    return createElement("span", {
        role: "img",
        "aria-label": tNow(
            mark === "waiting" ? "navigation.items.sessionWaiting" : "navigation.items.sessionLive",
        ),
        className: `size-1.5 rounded-full ${mark === "waiting" ? "bg-[var(--ag-run-status-warning)]" : "bg-foreground"}`,
    })
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
                  {className: "-mr-1 flex w-4 shrink-0 items-center justify-center"},
                  status,
              )
            : null,
    )

/** A running session's title shimmers, the same live-text sweep the chat uses. */
export const RUNNING_TITLE =
    "[&_span[title]]:bg-[linear-gradient(90deg,var(--colorTextQuaternary)_0%,var(--foreground)_50%,var(--colorTextQuaternary)_100%)] [&_span[title]]:bg-clip-text motion-safe:[&_span[title]]:animate-text-shimmer motion-safe:[&_span[title]]:bg-[length:200%_100%] motion-safe:[&_span[title]]:text-transparent"
