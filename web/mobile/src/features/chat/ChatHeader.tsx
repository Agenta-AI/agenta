import {fetchSessionStream} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"
import Link from "next/link"

export const ChatHeader = ({
    sessionId,
    projectId,
    workspaceId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
}) => {
    const query = useQuery({
        queryKey: ["mobile", "session-stream", projectId, sessionId],
        queryFn: () => fetchSessionStream({sessionId, projectId}),
        enabled: Boolean(projectId && sessionId),
        staleTime: 30_000,
    })
    return (
        <header className="border-border flex shrink-0 flex-col gap-1 border-b p-4">
            <div className="flex items-center gap-2">
                <Link
                    href={`/w/${workspaceId}/p/${projectId}/sessions`}
                    className="text-muted-foreground shrink-0 text-xs underline underline-offset-4"
                >
                    Back
                </Link>
                <h1 className="truncate text-sm font-semibold">{query.data?.name ?? "Session"}</h1>
            </div>
            <p className="text-muted-foreground text-xs">
                Read-only on mobile for now — continue this session on desktop.
            </p>
        </header>
    )
}
