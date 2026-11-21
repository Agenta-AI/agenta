import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {useIsPhone} from "@agenta/ui/phone"
import {Button} from "@agenta/ui/ui"

import {useOpenAgentBuilder} from "../agent-layout/AgentPageBuilderHost"
import {NavDrawer} from "../nav/NavDrawer"
import {SESSIONS_PAGE_FRAME} from "../sessions/pageFrame"

import {AgentPagesHeader} from "./AgentPagesHeader"

/** The page column of the agent's Sessions page on a desktop (A02). */
export const AGENT_SESSIONS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[1120px] px-8 pb-12 pt-4"
/** The page column of the agent's Analytics page on a desktop (A09). */
export const AGENT_ANALYTICS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[928px] px-8 pb-10 pt-4"
/** The page column of the agent's Channels page on a desktop (A07). */
export const AGENT_CHANNELS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[760px] pb-6 pt-4"

/**
 * The header of an agent's Sessions, Analytics and Channels pages: the agent pages header (a
 * 48 px bar; it shows the Builder icon when the builder panel host is on the page) on a desktop,
 * the phone page header on a phone (with the same Builder icon at the right).
 */
export const AgentListPageHeader = ({
    title,
    workspaceId,
    projectId,
}: {
    title: ReactNode
    workspaceId: string
    projectId: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const phone = useIsPhone()
    const openBuilder = useOpenAgentBuilder()
    if (!phone) {
        return <AgentPagesHeader title={title} workspaceId={workspaceId} projectId={projectId} />
    }
    return (
        // The phone page header: 52 px with a line under it (M13).
        <div
            className={`box-border flex h-[52px] shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary px-1 ${SESSIONS_PAGE_FRAME}`}
        >
            {/* The 44 px menu button at x 4, the title 10 px after it (M13). */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-5 text-foreground">
                    {title}
                </h1>
            </div>
            {openBuilder ? (
                <Button
                    variant="ghost"
                    size="icon-compact"
                    aria-label={t("agentLayout.header.builder")}
                    className="shrink-0"
                    onClick={openBuilder}
                >
                    <BuilderIcon />
                </Button>
            ) : null}
        </div>
    )
}
