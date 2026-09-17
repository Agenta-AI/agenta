import {sessionTabCloseTargets, type SessionTabCloseTargets} from "@agenta/sessions/state"
import {ArrowLineRightIcon, XIcon, XSquareIcon} from "@phosphor-icons/react"

import {type SessionMenuEntry} from "./menu"
import {withShortcutKey} from "./menuShortcut"

/**
 * The rail's own menu verbs, appended to the host's. Reserved keys, handled here and never
 * forwarded — the host knows nothing about tab order.
 *
 * They exist because touch cannot drag: a long press opens this very menu (see SessionTabDragItem),
 * so moving a tab by hand has to be sayable in words too. They are equally the keyboard path.
 */
export const MOVE_LEFT = "__rail-move-left"
export const MOVE_RIGHT = "__rail-move-right"

/** Chrome's tab-close verbs, likewise reserved and handled here. */
export const CLOSE = "__rail-close"
export const CLOSE_OTHERS = "__rail-close-others"
export const CLOSE_RIGHT = "__rail-close-right"

export const closeEntries = (targets: SessionTabCloseTargets): SessionMenuEntry[] => [
    {type: "divider"},
    {
        key: CLOSE,
        label: withShortcutKey("Close", "session.close"),
        icon: <XIcon size={14} />,
        disabled: !targets.closable,
    },
    {
        key: CLOSE_OTHERS,
        label: "Close other tabs",
        icon: <XSquareIcon size={14} />,
        disabled: targets.others.length === 0,
    },
    {
        key: CLOSE_RIGHT,
        label: "Close tabs to the right",
        icon: <ArrowLineRightIcon size={14} />,
        disabled: targets.toRight.length === 0,
    },
]

export const moveEntries = (index: number, count: number): SessionMenuEntry[] =>
    count < 2
        ? []
        : [
              {type: "divider"},
              {key: MOVE_LEFT, label: "Move left", disabled: index === 0},
              {key: MOVE_RIGHT, label: "Move right", disabled: index === count - 1},
          ]

/**
 * The menu an UNLISTED chip carries — a session whose row has not landed, so there is no
 * view-model for the host's verbs. The tab verbs need only the strip, so they stay; without
 * them a right-click did nothing and the menu read as broken (#6379). No leading divider:
 * nothing sits above them.
 */
export const unlistedTabMenu = (
    tabs: readonly {id: string; pinned: boolean}[],
    id: string,
): SessionMenuEntry[] => closeEntries(sessionTabCloseTargets(tabs, id)).slice(1)

/** The tabs a reserved close key names for the chip at `id`; null for any other key. */
export const unlistedTabCloseIds = (
    key: string,
    tabs: readonly {id: string; pinned: boolean}[],
    id: string,
): string[] | null => {
    if (key === CLOSE) return [id]
    if (key !== CLOSE_OTHERS && key !== CLOSE_RIGHT) return null
    const targets = sessionTabCloseTargets(tabs, id)
    return key === CLOSE_OTHERS ? targets.others : targets.toRight
}
