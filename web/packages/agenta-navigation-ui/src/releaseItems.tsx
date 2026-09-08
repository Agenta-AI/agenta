import type {ReactNode} from "react"

import {ALL_RELEASES_LINK, RELEASES, type SidebarConfig} from "@agenta/navigation"
import {CircleIcon, PackageIcon} from "@phosphor-icons/react"

/** Newest first, capped: the menu says what changed lately, not the whole changelog. */
const RECENT_RELEASE_COUNT = 3

/** The list breathes a little more than the destinations above it: four titles read down as a
 * timeline, and at the destinations' rhythm they ran together. */
const RELEASE_ROW = "py-1"

/**
 * The glyph column, drawn as a timeline: a hairline runs between the entries and each one
 * interrupts it with its own mark. The line says these are consecutive releases rather than four
 * unrelated links, which a column of identical dots does not.
 *
 * The mark carries the menu's own background so the hairline passes behind it, not through it.
 */
const ReleaseGlyph = ({first, last}: {first?: boolean; last?: boolean}): ReactNode => (
    <span className="relative flex h-6 w-4 items-center justify-center">
        {/* Overshoot the glyph box at each end: segments that stopped at its edge left a gap at
            every row boundary and the timeline read as four detached ticks. `colorBorder`, not
            the secondary step: in dark that is #303030 against a #242424 popover, a hairline you
            cannot see. */}
        {first ? null : (
            <span className="absolute left-1/2 -top-1.5 h-[calc(50%+6px)] w-px -translate-x-1/2 bg-colorBorder" />
        )}
        {last ? null : (
            <span className="absolute -bottom-1.5 left-1/2 h-[calc(50%+6px)] w-px -translate-x-1/2 bg-colorBorder" />
        )}
        <span className="relative flex items-center justify-center bg-colorBgElevated px-0.5 py-1">
            {last ? (
                <PackageIcon size={14} className="text-colorTextSecondary" />
            ) : (
                <CircleIcon size={7} weight="fill" className="text-colorTextQuaternary" />
            )}
        </span>
    </span>
)

/**
 * The help menu's "What's new?" block: a heading, the recent releases, and the way to the rest.
 *
 * Shared by both rails so one changelog reads the same in the desktop app and in `/m`. `version`
 * rides the last row — the running build belongs beside the list of what shipped.
 */
export const buildReleaseNavItems = (version?: string): SidebarConfig[] => [
    {key: "releases-heading", title: "What's new?", isGroupLabel: true},
    ...RELEASES.slice(0, RECENT_RELEASE_COUNT).map((release, index) => ({
        key: release.id,
        title: release.title,
        link: release.link,
        icon: <ReleaseGlyph first={index === 0} />,
        rowClassName: RELEASE_ROW,
    })),
    {
        key: "all-releases",
        title: "View all releases",
        link: ALL_RELEASES_LINK,
        icon: <ReleaseGlyph last />,
        rowClassName: RELEASE_ROW,
        suffix: version ? (
            <span className="text-[11px] leading-none text-colorTextTertiary">v{version}</span>
        ) : undefined,
    },
]
