import {WorkspaceContextRedirect} from "@/features/context/WorkspaceContextRedirect"

// `/m/w/:workspace_id` — forward to a project home inside that workspace.
export default function WorkspacePage() {
    return <WorkspaceContextRedirect />
}
