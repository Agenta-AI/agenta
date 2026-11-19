import type {ReactNode} from "react"

import type {SidebarConfig} from "./types"

/** Where the support entries point. Static, so both shells carry the same destinations. */
export const SUPPORT_URLS = {
    docs: "https://agenta.ai/docs/",
    github: "https://github.com/Agenta-AI/agenta/issues",
    slack: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
} as const

export type SupportLinkKey = keyof typeof SUPPORT_URLS

/** Icons stay with the shell — each app draws from its own icon set. */
export type SupportLinkIcons = Partial<Record<SupportLinkKey | "help", ReactNode>>

export interface HelpDocsItemOptions {
    icons?: SupportLinkIcons
    /** Appended after the destinations (the Live Chat toggle, keyboard shortcuts, releases). */
    extraItems?: SidebarConfig[]
    /** Right-aligned content on the row (the app version); hidden when the rail collapses. */
    suffix?: ReactNode
}

/**
 * The "Help & Docs" entry, shared by the rail and the drawer: the same destinations in the same
 * order. Host-specific rows (Live Chat, which needs Crisp; the shortcuts sheet, which the host
 * mounts) arrive through `extraItems`.
 */
export const buildHelpDocsNavItem = ({
    icons = {},
    extraItems = [],
    suffix,
}: HelpDocsItemOptions = {}): SidebarConfig => ({
    key: "help-docs-link",
    title: "Help & Docs",
    icon: icons.help,
    suffix,
    submenu: [
        {
            key: "docs",
            title: "Documentation",
            link: SUPPORT_URLS.docs,
            icon: icons.docs,
        },
        {
            key: "github-support",
            title: "GitHub Support",
            link: SUPPORT_URLS.github,
            icon: icons.github,
        },
        {
            key: "slack-connect",
            title: "Slack Support",
            link: SUPPORT_URLS.slack,
            icon: icons.slack,
        },
        ...extraItems,
    ],
})
