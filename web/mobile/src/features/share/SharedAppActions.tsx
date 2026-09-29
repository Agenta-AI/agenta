import {type SharedAppSnapshot} from "@agenta/entities/drive"
import {ShareAppButton} from "@agenta/entity-ui/drive"
import {Button} from "@agenta/ui/ui"
import Link from "next/link"

import {useSignInAndReturn} from "@/features/auth/useSignInAndReturn"

/** Sign in for a signed-out viewer; for a signed-in one, what they may do. */
export const SharedAppActions = ({
    snapshot,
    signedIn,
}: {
    snapshot: SharedAppSnapshot | null
    signedIn: boolean
}) => {
    const signIn = useSignInAndReturn()

    if (!signedIn) {
        return (
            <Button size="xs" onClick={signIn}>
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
            {sessionHref ? (
                <Button asChild variant="ghost" size="xs">
                    <Link href={sessionHref}>Open in chat</Link>
                </Button>
            ) : null}
            {snapshot && editable && viewer.project_id ? (
                <ShareAppButton
                    mountId={viewer.mount_id ?? null}
                    dir={viewer.app_path ?? ""}
                    canEdit
                    appName={snapshot.name}
                    projectId={viewer.project_id}
                    size="xs"
                />
            ) : null}
        </div>
    )
}
