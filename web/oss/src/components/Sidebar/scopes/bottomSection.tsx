import {useCallback, useMemo, type MouseEvent} from "react"

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
import {useSetAtom} from "jotai"

import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isDemo} from "@/oss/lib/helpers/utils"
import {openWidgetAtom} from "@/oss/lib/onboarding"
import {useOrgData} from "@/oss/state/org"

import type {SidebarConfig, SidebarSection} from "../engine/types"

interface SidebarBottomSectionOptions {
    includeSettingsLink?: boolean
}

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

    const sharedItems = useMemo<SidebarConfig[]>(
        () => [
            {
                key: "invite-teammate-link",
                title: "Invite Teammate",
                link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
                icon: <PaperPlaneIcon size={14} />,
                tooltip: "Invite Teammate",
                isHidden: !doesSessionExist || !selectedOrg || !canInviteMembers,
                disabled: !hasProjectURL,
            },
            {
                key: "get-started-guide-link",
                title: "Get Started Guide",
                icon: (
                    <span id="sidebar-get-started-guide">
                        <RocketLaunchIcon size={16} />
                    </span>
                ),
                tooltip: "Open the onboarding guide",
                isHidden: !doesSessionExist,
                onClick: handleOpenWidget,
            },
            {
                key: "support-chat-link",
                title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
                icon: <ChatCircleIcon size={14} />,
                isHidden: !isDemo() || !isCrispEnabled,
                onClick: handleToggleSupport,
            },
            {
                key: "help-docs-link",
                title: "Help & Docs",
                icon: <QuestionIcon size={14} />,
                submenu: [
                    {
                        key: "docs",
                        title: "Documentation",
                        link: "https://agenta.ai/docs/",
                        icon: <ScrollIcon size={14} />,
                        divider: true,
                    },
                    {
                        key: "github-support",
                        title: "GitHub Support",
                        link: "https://github.com/Agenta-AI/agenta/issues",
                        icon: <GithubFilled style={{fontSize: 14}} />,
                    },
                    {
                        key: "slack-connect",
                        title: "Slack Support",
                        link: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
                        icon: <SlackLogoIcon size={14} />,
                        divider: true,
                    },
                    {
                        key: "book-call",
                        title: "Book a call",
                        link: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
                        icon: <PhoneIcon size={14} />,
                    },
                ],
            },
        ],
        [
            canInviteMembers,
            doesSessionExist,
            handleOpenWidget,
            handleToggleSupport,
            hasProjectURL,
            isCrispEnabled,
            isVisible,
            projectURL,
            selectedOrg,
        ],
    )

    return useMemo(
        () => ({
            key: "bottom",
            items: includeSettingsLink ? [settingsLink, ...sharedItems] : sharedItems,
            placement: "bottom",
            mode: "vertical",
        }),
        [includeSettingsLink, settingsLink, sharedItems],
    )
}
