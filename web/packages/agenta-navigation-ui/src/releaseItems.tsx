import type {ReactNode} from "react"

import {
    ALL_RELEASES_LINK,
    RELEASES,
    UPGRADE_GUIDE_LINK,
    type Notice,
    type Release,
    type SidebarConfig,
    type UpdateSize,
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

/**
 * The color of the update marks (the dot on the help icon and the arrow on the update row) by the
 * size of the newest missing update: red for a security fix, amber for a newer minor, grey when
 * only patches are missing. Theme tokens, so both themes stay right.
 */
export const UPDATE_SIZE_COLOR: Record<UpdateSize, {text: string; bg: string}> = {
    security: {text: "text-colorError", bg: "bg-colorError"},
    minor: {text: "text-colorWarning", bg: "bg-colorWarning"},
    patch: {text: "text-colorTextTertiary", bg: "bg-colorTextTertiary"},
}

/** The red tag on a release that carries a security fix. */
const SecurityTag = ({children}: {children: ReactNode}) => (
    <span className="rounded bg-colorErrorBg px-1 text-[10.5px] font-medium leading-4 text-colorErrorText">
        {children}
    </span>
)

/** The visible text of the block; the shell supplies it in the reader's language. */
export interface ReleaseNavLabels {
    whatsNew: string
    viewAll: string
    /** The update row, e.g. "New minor version: v0.131.0". Only read when behind. */
    update: string
    /** The update row's note, e.g. "3 releases behind". Only read when behind. */
    releasesBehind: string
    notInstalled: string
    securityFix: string
}

export interface ReleaseNavOptions {
    /** The bundled list merged with the release feed. Defaults to the bundled list. */
    releases?: Release[]
    /** Releases newer than the running version that the reader can install. */
    notInstalled?: Release[]
    /** Feed notices that already passed their filters. */
    notices?: Notice[]
    /** Opens a notice. Without it, a notice row is a plain link. */
    onOpenNotice?: (notice: Notice) => void
    /** The size of the newest missing update; colors the update row's arrow. */
    updateSize?: UpdateSize | null
    /** Opens the newest missing release. Without it, the update row links to the upgrade guide. */
    onOpenUpdate?: (release: Release) => void
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
    appVersion: string | undefined,
    labels: ReleaseNavLabels,
    {
        releases = RELEASES,
        notInstalled = [],
        notices = [],
        onOpenNotice,
        updateSize,
        onOpenUpdate,
    }: ReleaseNavOptions = {},
): SidebarConfig[] => {
    const newer = new Set(notInstalled.map((release) => release.id))
    const newest = notInstalled[0]
    return [
        {key: "releases-heading", title: labels.whatsNew, isGroupLabel: true},
        ...notices.map((notice) => ({
            key: `notice:${notice.id}`,
            title: notice.title,
            // The help menu flyout draws the subtitle but not the tooltip.
            subtitle: notice.body,
            tooltip: notice.body,
            ...(onOpenNotice ? {onClick: () => onOpenNotice(notice)} : {link: notice.link}),
            icon:
                notice.severity === "warning" ? (
                    <WarningIcon size={14} className="text-colorWarning" />
                ) : (
                    <InfoIcon size={14} className="text-colorTextSecondary" />
                ),
        })),
        ...(newest
            ? [
                  {
                      key: "update-available",
                      title: labels.update,
                      ...(onOpenUpdate
                          ? {onClick: () => onOpenUpdate(newest)}
                          : {link: UPGRADE_GUIDE_LINK}),
                      icon: (
                          <ArrowCircleUpIcon
                              size={14}
                              weight="fill"
                              className={UPDATE_SIZE_COLOR[updateSize ?? "patch"].text}
                          />
                      ),
                      // Under the label, not beside it: the two side by side did not fit.
                      subtitle: labels.releasesBehind,
                  },
              ]
            : []),
        ...releases.slice(0, RECENT_RELEASE_COUNT).map((release, index) => ({
            key: release.id,
            title: release.features[0]?.title ?? release.id,
            link: release.features[0]?.link ?? ALL_RELEASES_LINK,
            icon: <ReleaseGlyph first={index === 0} />,
            rowClassName: RELEASE_ROW,
            suffix: newer.has(release.id) ? (
                <span className="flex items-center gap-1">
                    {release.securityFix ? <SecurityTag>{labels.securityFix}</SecurityTag> : null}
                    <RowNote>{labels.notInstalled}</RowNote>
                </span>
            ) : undefined,
        })),
        {
            key: "all-releases",
            title: labels.viewAll,
            link: ALL_RELEASES_LINK,
            icon: <ReleaseGlyph last />,
            rowClassName: RELEASE_ROW,
            suffix: appVersion ? <RowNote>v{appVersion}</RowNote> : undefined,
        },
    ]
}
