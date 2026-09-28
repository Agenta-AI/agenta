import {type SharedAppSnapshot} from "@agenta/entities/drive"
import {useProfile} from "@agenta/entities/profile"

import {AgentaLogo} from "@/components/AgentaLogo"

import {SharedAppActions} from "./SharedAppActions"

/** The strip above a shared app: who made it, and what this viewer can do. */
export const SharedAppHeader = ({snapshot}: {snapshot: SharedAppSnapshot | null}) => {
    const {user} = useProfile()
    const byline = snapshot
        ? snapshot.viewer.is_owner
            ? "App by you"
            : snapshot.authorName
              ? `App by ${snapshot.authorName}`
              : "Shared app"
        : null

    return (
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
            <AgentaLogo className="h-5 w-auto shrink-0 text-foreground" />
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium text-foreground">
                    {snapshot?.name ?? "Shared app"}
                </span>
                {byline ? (
                    <span className="truncate text-xs text-muted-foreground">{byline}</span>
                ) : null}
            </div>
            <span className="flex-1" />
            <SharedAppActions snapshot={snapshot} user={user ?? null} />
        </header>
    )
}
