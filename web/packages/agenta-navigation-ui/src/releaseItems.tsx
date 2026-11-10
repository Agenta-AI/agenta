import type {ReactNode} from "react"

import {
    ALL_RELEASES_LINK,
    RELEASES,
    UPGRADE_GUIDE_LINK,
    type Notice,
    type Release,
    type SidebarConfig,
} from "@agenta/navigation"
import {
    ArrowCircleUpIcon,
    CircleIcon,
    InfoIcon,
    PackageIcon,
    WarningIcon,
} from "@phosphor-icons/react"

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
 * The track STOPS short of the mark rather than running under it behind a painted swatch. The
 * swatch was the menu's own background, so on a hovered row it showed as a pale square around
 * the dot; a gap needs no colour and is right on every row state.
 */
const ReleaseGlyph = ({first, last}: {first?: boolean; last?: boolean}): ReactNode => (
    <span className="relative flex h-6 w-4 items-center justify-center">
        {/* Overshoot the glyph box at each end: segments that stopped at its edge left a gap at
            every row boundary and the timeline read as four detached ticks. `colorBorder`, not
            the secondary step: in dark that is #303030 against a #242424 popover, a hairline you
            cannot see. The 10px height leaves 16px clear in the middle, which the 14px package
            icon fits inside. */}
        {first ? null : (
            <span className="absolute left-1/2 -top-1.5 h-[10px] w-px -translate-x-1/2 bg-colorBorder" />
        )}
        {last ? null : (
            <span className="absolute -bottom-1.5 left-1/2 h-[10px] w-px -translate-x-1/2 bg-colorBorder" />
        )}
        <span className="relative flex items-center justify-center">
            {last ? (
                <PackageIcon size={14} className="text-colorTextSecondary" />
            ) : (
                <CircleIcon
                    size={8}
                    weight="fill"
                    // size-2: the menu item scales unsized svgs to 16px.
                    className="size-2 text-colorTextQuaternary"
                />
            )}
        </span>
    </span>
)

const RowNote = ({children}: {children: ReactNode}) => (
    <span className="text-[11px] leading-none text-colorTextTertiary">{children}</span>
)

export interface ReleaseNavOptions {
    /** The bundled list merged with the release feed. Defaults to the bundled list. */
    releases?: Release[]
    /** Releases newer than the running version that the reader can install. */
    notInstalled?: Release[]
    /** Feed notices that already passed their filters. */
    notices?: Notice[]
    /** Opens a notice. Without it, a notice row is a plain link. */
    onOpenNotice?: (notice: Notice) => void
}

/**
 * The help menu's "What's new?" block: a heading, the feed's notices, the way to upgrade when a
 * newer release exists, the recent releases, and the way to the rest.
 *
 * Shared by both rails so one changelog reads the same in the desktop app and in `/m`.
 * `appVersion` (the web build, without the "v") rides the last row — the running build belongs
 * beside the list of what shipped.
 */
export const buildReleaseNavItems = (
    appVersion?: string,
    {releases = RELEASES, notInstalled = [], notices = [], onOpenNotice}: ReleaseNavOptions = {},
): SidebarConfig[] => {
    const newer = new Set(notInstalled.map((release) => release.id))
    return [
        {key: "releases-heading", title: "What's new?", isGroupLabel: true},
        ...notices.map((notice) => ({
            key: `notice:${notice.id}`,
            title: notice.title,
            tooltip: notice.body,
            ...(onOpenNotice ? {onClick: () => onOpenNotice(notice)} : {link: notice.link}),
            icon:
                notice.severity === "warning" ? (
                    <WarningIcon size={14} className="text-colorWarning" />
                ) : (
                    <InfoIcon size={14} className="text-colorTextSecondary" />
                ),
        })),
        ...(newer.size > 0
            ? [
                  {
                      key: "update-available",
                      title: "Update available",
                      link: UPGRADE_GUIDE_LINK,
                      icon: <ArrowCircleUpIcon size={14} className="text-colorSuccessText" />,
                      suffix: <RowNote>How to upgrade</RowNote>,
                  },
              ]
            : []),
        ...releases.slice(0, RECENT_RELEASE_COUNT).map((release, index) => ({
            key: release.id,
            title: release.features[0]?.title ?? release.id,
            link: release.features[0]?.link ?? ALL_RELEASES_LINK,
            icon: <ReleaseGlyph first={index === 0} />,
            rowClassName: RELEASE_ROW,
            suffix: newer.has(release.id) ? <RowNote>Not installed</RowNote> : undefined,
        })),
        {
            key: "all-releases",
            title: "View all releases",
            link: ALL_RELEASES_LINK,
            icon: <ReleaseGlyph last />,
            rowClassName: RELEASE_ROW,
            suffix: appVersion ? <RowNote>v{appVersion}</RowNote> : undefined,
        },
    ]
}
