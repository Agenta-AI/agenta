import type {ReactNode} from "react"

import {useIsPhone} from "@agenta/ui/phone"

import {NavDrawer} from "../nav/NavDrawer"

import {AgentPagesHeader} from "./AgentPagesHeader"

/** The page column of the agent's Sessions page on a desktop (A02). */
export const AGENT_SESSIONS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[1120px] px-8 pb-12 pt-4"
/** The page column of the agent's Analytics page on a desktop (A09). */
export const AGENT_ANALYTICS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[928px] px-8 pb-10 pt-4"
/** The page column of the agent's Channels page on a desktop (A07). */
export const AGENT_CHANNELS_PAGE_COLUMN = "mx-auto box-border w-full max-w-[760px] pb-6 pt-4"

/**
 * The header of an agent's Sessions, Analytics and Channels pages: the agent pages header (a
 * 48 px bar with the Builder icon) on a desktop, the phone page header on a phone.
 */
export const AgentListPageHeader = ({
    title,
    workspaceId,
    projectId,
    phoneFrame,
}: {
    title: ReactNode
    workspaceId: string
    projectId: string
    /** The phone header's column classes, so it lines up with the page body under it. */
    phoneFrame: string
}) => {
    const phone = useIsPhone()
    if (!phone) {
        return <AgentPagesHeader title={title} workspaceId={workspaceId} projectId={projectId} />
    }
    return (
        // The phone page header: 52 px with a line under it (M13).
        <div
            className={`box-border flex h-[52px] shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary px-4 ${phoneFrame}`}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground">
                    {title}
                </h1>
            </div>
        </div>
    )
}
