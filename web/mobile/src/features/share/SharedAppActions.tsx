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
    // A chat's app opens in its chat; an agent-drive app belongs to the agent, not to one chat.
    const project =
        viewer?.can_open_session && viewer.workspace_id && viewer.project_id
            ? `/w/${encodeURIComponent(viewer.workspace_id)}/p/${encodeURIComponent(viewer.project_id)}`
            : null
    const openLink = !project
        ? null
        : viewer?.session_id
          ? {
                href: `${project}/sessions/${encodeURIComponent(viewer.session_id)}`,
                label: "Open in chat",
            }
          : viewer?.agent_id
            ? {
                  href: `${project}/agents/${encodeURIComponent(viewer.agent_id)}`,
                  label: "Open agent",
              }
            : null
    const editable = viewer?.role === "editor" && viewer.mount_id && viewer.app_path

    return (
        <div className="flex shrink-0 items-center gap-1.5">
            {openLink ? (
                <Button asChild variant="ghost" size="xs">
                    <Link href={openLink.href}>{openLink.label}</Link>
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
