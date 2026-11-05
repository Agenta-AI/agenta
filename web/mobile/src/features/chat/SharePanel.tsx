import type {ReactNode} from "react"

import {IconTile} from "@agenta/ui/ui"
import {LinkIcon} from "@phosphor-icons/react"

const SECTION = "flex flex-col gap-2.5 px-3.5 py-3"
const LABEL = "text-muted-foreground text-xs"

/** The Share panel's three parts, the same in a popover and in a phone's sheet. */
export const SharePanel = ({
    agentAccess,
    agentAccessLabel,
    session,
    reuse,
}: {
    /** Who can use the agent and the reader's action on it. */
    agentAccess: ReactNode
    agentAccessLabel: string
    /** This chat's name and control. Absent on first run, where no chat exists yet. */
    session?: {name: string; hint: string | null; control: ReactNode} | null
    /** The template requests. Absent where the reader cannot send. */
    reuse?: ReactNode
}) => (
    <div className="divide-border flex flex-col divide-x-0 divide-y divide-solid">
        <section className={SECTION}>
            <span className={LABEL}>{agentAccessLabel}</span>
            {agentAccess}
        </section>
        {session ? (
            <section className={SECTION}>
                <span className={LABEL}>This chat</span>
                <div className="flex items-center gap-2.5">
                    <IconTile tone="muted" aria-hidden>
                        <LinkIcon />
                    </IconTile>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-medium">{session.name}</span>
                        {session.hint ? (
                            <span className="text-muted-foreground text-xs">{session.hint}</span>
                        ) : null}
                    </span>
                    {session.control}
                </div>
            </section>
        ) : null}
        {reuse ? (
            <section className="flex flex-col gap-1 p-1.5 pt-2.5">
                <span className={`${LABEL} px-2`}>Reuse this agent</span>
                {reuse}
            </section>
        ) : null}
    </div>
)
