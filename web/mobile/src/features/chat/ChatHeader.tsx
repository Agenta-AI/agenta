import {querySessionStreams} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"
import Link from "next/link"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"

export const ChatHeader = ({
    sessionId,
    projectId,
    workspaceId,
    subtitle,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    /** Small line under the title (the replay screen's read-only note). Absent = none. */
    subtitle?: string
}) => {
    // The singular GET /sessions/streams redirects with a root-path-less Location
    // behind the /api prefix and lands on the web app — use the proven query POST.
    const query = useQuery({
        queryKey: ["mobile", "session-stream", projectId, sessionId],
        queryFn: async () => (await querySessionStreams({sessionId, projectId}))?.[0] ?? null,
        enabled: Boolean(projectId && sessionId),
        staleTime: 30_000,
    })
    return (
        <>
            <PageTitle parts={[query.data?.name]} />
            <header className="border-border shrink-0 border-b p-4">
                <ContentRail className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <Link
                            href={`/w/${workspaceId}/p/${projectId}/sessions`}
                            className="text-muted-foreground -m-3 shrink-0 p-3 text-xs underline underline-offset-4"
                        >
                            Back
                        </Link>
                        <h1 className="truncate text-sm font-semibold">
                            {query.data?.name ?? "Session"}
                        </h1>
                    </div>
                    {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
                </ContentRail>
            </header>
        </>
    )
}
