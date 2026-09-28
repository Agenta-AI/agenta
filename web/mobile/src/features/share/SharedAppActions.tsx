import {useState} from "react"

import {type SharedAppSnapshot} from "@agenta/entities/drive"
import {ShareAppDialog} from "@agenta/entity-ui/drive"
import {Button} from "@agenta/ui/ui"
import Link from "next/link"
import {useRouter} from "next/router"

import {rememberReturnPath} from "@/lib/context"

import {SharedAppVersionMenu} from "./SharedAppVersionMenu"
import {ViewerAvatar} from "./ViewerAvatar"

interface Viewer {
    username?: string | null
    email?: string | null
}

/** Sign in for a signed-out viewer; for a signed-in one, their avatar and what they may do. */
export const SharedAppActions = ({
    snapshot,
    token,
    user,
}: {
    snapshot: SharedAppSnapshot | null
    token: string
    user: Viewer | null
}) => {
    const router = useRouter()
    const [sharing, setSharing] = useState(false)

    if (!user) {
        return (
            <Button
                size="sm"
                onClick={() => {
                    rememberReturnPath(router.asPath)
                    void router.push("/auth")
                }}
            >
                Sign in
            </Button>
        )
    }

    const viewer = snapshot?.viewer
    const sessionHref =
        viewer?.can_open_session && viewer.workspace_id && viewer.project_id && viewer.session_id
            ? `/w/${encodeURIComponent(viewer.workspace_id)}/p/${encodeURIComponent(viewer.project_id)}/sessions/${encodeURIComponent(viewer.session_id)}`
            : null
    const editable = viewer?.role === "editor" && viewer.mount_id && viewer.app_path

    return (
        <div className="flex shrink-0 items-center gap-1.5">
            {snapshot && editable ? (
                <SharedAppVersionMenu snapshot={snapshot} token={token} />
            ) : null}
            {sessionHref ? (
                <Button asChild variant="ghost" size="sm">
                    <Link href={sessionHref}>Open in session</Link>
                </Button>
            ) : null}
            {snapshot && editable && viewer.project_id ? (
                <>
                    <Button variant="outline" size="sm" onClick={() => setSharing(true)}>
                        Share
                    </Button>
                    {sharing ? (
                        <ShareAppDialog
                            open={sharing}
                            onOpenChange={setSharing}
                            projectId={viewer.project_id}
                            mount={{
                                id: viewer.mount_id as string,
                                session_id: viewer.session_id ?? "shared",
                                name: "cwd",
                            }}
                            dir={viewer.app_path as string}
                            appName={snapshot.name}
                        />
                    ) : null}
                </>
            ) : null}
            <ViewerAvatar user={user} />
        </div>
    )
}
