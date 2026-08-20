import {useCallback, useMemo, type MouseEvent} from "react"

import {buildHelpDocsNavItem, buildInviteTeammateNavItem} from "@agenta/navigation"
import type {SidebarConfig, SidebarSection} from "@agenta/navigation"
import {GithubFilled} from "@ant-design/icons"
import {
    ChatCircleIcon,
    GearIcon,
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
import {useOrgData} from "@/oss/state/org"

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
    const {selectedOrg} = useOrgData()
    const {canInviteMembers} = useWorkspacePermissions()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL} = useURL()
    const openWidget = useSetAtom(openWidgetAtom)
    const hasProjectURL = Boolean(projectURL)
    const versionState = useAtomValue(versionAtom)
    const version = versionState.state === "hasData" ? versionState.data : undefined

    const handleOpenWidget = useCallback(
        (e: MouseEvent) => {
            e.preventDefault()
            openWidget()
        },
        [openWidget],
    )

    const handleToggleSupport = useCallback(
        (e: MouseEvent) => {
            e.preventDefault()
            toggle()
        },
        [toggle],
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
                isHidden: !doesSessionExist || !selectedOrg || !canInviteMembers,
            }),
        [canInviteMembers, doesSessionExist, hasProjectURL, projectURL, selectedOrg],
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
            // The four destinations are shared with the mobile drawer; Live Chat needs Crisp,
            // so it rides in as an extra rather than being reproduced there.
            buildHelpDocsNavItem({
                icons: {
                    help: <QuestionIcon size={14} />,
                    docs: <ScrollIcon size={14} />,
                    github: <GithubFilled style={{fontSize: 14}} />,
                    slack: <SlackLogoIcon size={14} />,
                    bookCall: <PhoneIcon size={14} />,
                },
                // Live Chat relocates here from a standalone row; keep the divider only when it
                // will actually render (demo + Crisp), else it dangles.
                dividerAfterBookCall: isDemo() && isCrispEnabled,
                suffix: version ? (
                    <span className="text-[12px] leading-none text-colorTextTertiary">
                        v{version}
                    </span>
                ) : undefined,
                extraItems: [
                    {
                        key: "support-chat-link",
                        title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
                        icon: <ChatCircleIcon size={14} />,
                        isHidden: !isDemo() || !isCrispEnabled,
                        onClick: handleToggleSupport,
                    },
                ],
            }),
        ],
        [
            doesSessionExist,
            handleOpenWidget,
            handleToggleSupport,
            isCrispEnabled,
            isVisible,
            version,
        ],
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
