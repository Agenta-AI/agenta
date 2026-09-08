import {useCallback, useMemo, type MouseEvent} from "react"

import {
    ALL_RELEASES_LINK,
    buildHelpDocsNavItem,
    buildInviteTeammateNavItem,
    RELEASES,
} from "@agenta/navigation"
import type {SidebarConfig, SidebarSection} from "@agenta/navigation"
import {GithubFilled} from "@ant-design/icons"
import {
    ChatCircleIcon,
    CircleIcon,
    GearIcon,
    PackageIcon,
    PaperPlaneIcon,
    PhoneIcon,
    QuestionIcon,
    RocketLaunchIcon,
    ScrollIcon,
    SlackLogoIcon,
} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {loadable} from "jotai/utils"

import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isDemo} from "@/oss/lib/helpers/utils"
import {openWidgetAtom} from "@/oss/lib/onboarding"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"

interface SidebarBottomSectionOptions {
    includeSettingsLink?: boolean
}

// Hidden pending the new onboarding widget; flip back to true to restore the sidebar entry.
const SHOW_GET_STARTED_GUIDE = false

// Lazy-load package.json so its version stays out of the initial bundle.
const versionAtom = loadable(atom(async () => (await import("../../../../package.json")).version))

export const useSidebarBottomSection = ({
    includeSettingsLink = true,
}: SidebarBottomSectionOptions = {}): SidebarSection => {
    const {doesSessionExist} = useSession()
    // Route-derived and synchronous, so it survives the org switch's cache eviction:
    // `changeSelectedOrg` removes the ["selectedOrg", id] query BEFORE navigating, which left
    // this row hidden for a whole GET /organizations/{id} round-trip on every switch.
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const {canInviteMembers} = useWorkspacePermissions()
    const {projectURL} = useURL()
    const openWidget = useSetAtom(openWidgetAtom)
    const hasProjectURL = Boolean(projectURL)

    const handleOpenWidget = useCallback(
        (e: MouseEvent) => {
            e.preventDefault()
            openWidget()
        },
        [openWidget],
    )

    const settingsLink = useMemo<SidebarConfig>(
        () => ({
            key: "settings-link",
            title: "Settings",
            link: `${projectURL}/settings`,
            icon: <GearIcon size={14} />,
            tooltip: "Settings",
            disabled: !hasProjectURL,
        }),
        [hasProjectURL, projectURL],
    )

    const inviteItem = useMemo<SidebarConfig>(
        () =>
            buildInviteTeammateNavItem({
                projectURL: hasProjectURL ? projectURL : "",
                icon: <PaperPlaneIcon size={14} />,
                isHidden: !doesSessionExist || !selectedOrgId || !canInviteMembers,
            }),
        [canInviteMembers, doesSessionExist, hasProjectURL, projectURL, selectedOrgId],
    )

    const sharedItems = useMemo<SidebarConfig[]>(
        () => [
            {
                key: "get-started-guide-link",
                title: "Get Started Guide",
                icon: (
                    <span id="sidebar-get-started-guide">
                        <RocketLaunchIcon size={16} />
                    </span>
                ),
                tooltip: "Open the onboarding guide",
                isHidden: !SHOW_GET_STARTED_GUIDE || !doesSessionExist,
                onClick: handleOpenWidget,
            },
        ],
        [doesSessionExist, handleOpenWidget],
    )

    return useMemo(
        () => ({
            key: "bottom",
            items: includeSettingsLink
                ? [settingsLink, inviteItem, ...sharedItems]
                : [inviteItem, ...sharedItems],
            placement: "bottom",
            mode: "vertical",
        }),
        [includeSettingsLink, settingsLink, inviteItem, sharedItems],
    )
}

/** Newest first, capped: the menu is a "what changed lately", not the whole changelog. */
const RECENT_RELEASE_COUNT = 3

/**
 * Help & Docs, as an item the rail renders as an icon button beside the project switcher.
 *
 * It carries the releases that used to be sidebar banner cards. News belongs in a list you
 * open, not in a card you dismiss one at a time.
 */
export const useSidebarHelpItem = (): SidebarConfig => {
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const versionState = useAtomValue(versionAtom)
    const version = versionState.state === "hasData" ? versionState.data : undefined

    const handleToggleSupport = useCallback(
        (e: MouseEvent) => {
            e.preventDefault()
            toggle()
        },
        [toggle],
    )

    return useMemo(
        () =>
            // The four destinations are shared with the mobile drawer; Live Chat needs Crisp,
            // so it rides in as an extra rather than being reproduced there.
            buildHelpDocsNavItem({
                icons: {
                    help: <QuestionIcon size={15} />,
                    docs: <ScrollIcon size={14} />,
                    github: <GithubFilled style={{fontSize: 14}} />,
                    slack: <SlackLogoIcon size={14} />,
                    bookCall: <PhoneIcon size={14} />,
                },
                // Always: the releases below now follow Book a call whether or not Live Chat does.
                dividerAfterBookCall: true,
                extraItems: [
                    {
                        key: "support-chat-link",
                        title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
                        icon: <ChatCircleIcon size={14} />,
                        isHidden: !isDemo() || !isCrispEnabled,
                        onClick: handleToggleSupport,
                    },
                    {key: "releases-heading", title: "What's new?", isGroupLabel: true},
                    ...RELEASES.slice(0, RECENT_RELEASE_COUNT).map((release) => ({
                        key: release.id,
                        title: release.title,
                        link: release.link,
                        icon: <CircleIcon size={7} weight="fill" />,
                    })),
                    {
                        key: "all-releases",
                        title: "View all releases",
                        link: ALL_RELEASES_LINK,
                        icon: <PackageIcon size={14} />,
                        // The running build, on the row that lists what shipped.
                        suffix: version ? (
                            <span className="text-[11px] leading-none text-colorTextTertiary">
                                v{version}
                            </span>
                        ) : undefined,
                    },
                ],
            }),
        [handleToggleSupport, isCrispEnabled, isVisible, version],
    )
}
