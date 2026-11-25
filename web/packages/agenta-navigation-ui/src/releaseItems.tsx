import type {ReactNode} from "react"

import {ALL_RELEASES_LINK, RELEASES, type SidebarConfig} from "@agenta/navigation"
import {PackageIcon} from "@phosphor-icons/react"

/** Newest first, capped: the menu says what changed lately, not the whole changelog. */
const RECENT_RELEASE_COUNT = 3

/**
 * The glyph column, drawn as a timeline: a hairline runs between the entries and each one
 * interrupts it with its own mark. The line says these are consecutive releases rather than four
 * unrelated links, which a column of identical dots does not.
 *
 * The track STOPS short of the mark rather than running under it behind a painted swatch. The
 * swatch was the menu's own background, so on a hovered row it showed as a pale square around
 * the dot; a gap needs no colour and is right on every row state.
 */
const ReleaseGlyph = ({first, last}: {first?: boolean; last?: boolean}): ReactNode => (
    <span className="relative flex h-6 w-4 items-center justify-center">
        {/* Overshoot the glyph box at each end: segments that stopped at its edge left a gap at
            every row boundary and the timeline read as four detached ticks. `colorBorder`, not
            the secondary step: in dark that is #303030 against a #242424 popover, a hairline you
            cannot see. The 10px height leaves 16px clear in the middle, which the 16px package
            icon fills. */}
        {first ? null : (
            <span className="absolute left-1/2 -top-1.5 h-[10px] w-px -translate-x-1/2 bg-border" />
        )}
        {last ? null : (
            <span className="absolute -bottom-1.5 left-1/2 h-[10px] w-px -translate-x-1/2 bg-border" />
        )}
        <span className="relative flex items-center justify-center">
            {last ? (
                <PackageIcon size={16} className="text-muted-foreground" />
            ) : (
                // A timeline node, not a filled icon (ICON-01; radius-xs is for timeline nodes).
                <span className="size-2 rounded-round bg-muted-foreground" />
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
export const buildReleaseNavItems = (
    version: string | undefined,
    labels: {whatsNew: string; viewAll: string},
): SidebarConfig[] => [
    {key: "releases-heading", title: labels.whatsNew, isGroupLabel: true},
    ...RELEASES.slice(0, RECENT_RELEASE_COUNT).map((release, index) => ({
        key: release.id,
        title: release.features[0]?.title ?? release.id,
        link: release.features[0]?.link ?? ALL_RELEASES_LINK,
        icon: <ReleaseGlyph first={index === 0} />,
    })),
    {
        key: "all-releases",
        title: labels.viewAll,
        link: ALL_RELEASES_LINK,
        icon: <ReleaseGlyph last />,
        suffix: version ? (
            <span className="text-caption leading-none text-muted-foreground">v{version}</span>
        ) : undefined,
    },
]
