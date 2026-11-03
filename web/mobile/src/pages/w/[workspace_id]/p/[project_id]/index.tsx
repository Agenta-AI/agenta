import {ProjectHomeRedirect} from "@/features/context/ProjectHomeRedirect"

// `/m/w/:workspace_id/p/:project_id` — forward to the project home.
export default function ProjectPage() {
    return <ProjectHomeRedirect />
}
