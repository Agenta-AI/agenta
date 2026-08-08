import type {ReactNode} from "react"

import type {SidebarConfig} from "./types"

/** Where the support entries point. Static, so both shells carry the same destinations. */
export const SUPPORT_URLS = {
    docs: "https://agenta.ai/docs/",
    github: "https://github.com/Agenta-AI/agenta/issues",
    slack: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
    bookCall: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
} as const

export type SupportLinkKey = keyof typeof SUPPORT_URLS

/** Icons stay with the shell — each app draws from its own icon set. */
export type SupportLinkIcons = Partial<Record<SupportLinkKey | "help", ReactNode>>

export interface HelpDocsItemOptions {
    icons?: SupportLinkIcons
    /** Appended after "Book a call" (desktop's Live Chat toggle). */
    extraItems?: SidebarConfig[]
    /** Divider under "Book a call" — only when something actually follows it. */
    dividerAfterBookCall?: boolean
    /** Right-aligned content on the row (desktop's app version); hidden when the rail collapses. */
    suffix?: ReactNode
}

/**
 * The "Help & Docs" entry, shared by the desktop rail and the mobile drawer: the same four
 * destinations in the same order. Host-specific rows (Live Chat, which needs Crisp) arrive
 * through `extraItems` rather than being reproduced per app.
 */
export const buildHelpDocsNavItem = ({
    icons = {},
    extraItems = [],
    dividerAfterBookCall = false,
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
            divider: true,
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
        {
            key: "book-call",
            title: "Book a call",
            link: SUPPORT_URLS.bookCall,
            icon: icons.bookCall,
            divider: dividerAfterBookCall,
        },
        ...extraItems,
    ],
})
