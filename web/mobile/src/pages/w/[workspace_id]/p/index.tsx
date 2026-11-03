import {WorkspaceContextRedirect} from "@/features/context/WorkspaceContextRedirect"

// `/m/w/:workspace_id/p` — same gate as the workspace index; the empty project segment
// carries no more information than its parent.
export default function WorkspaceProjectsPage() {
    return <WorkspaceContextRedirect />
}
