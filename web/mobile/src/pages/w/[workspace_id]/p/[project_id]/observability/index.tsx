import {useRouter} from "next/router"

import {ObservabilityScreen} from "@/features/observability/ObservabilityScreen"

export default function ObservabilityPage() {
    const router = useRouter()
    const {project_id: projectId} = router.query
    if (typeof projectId !== "string") return null
    return <ObservabilityScreen projectId={projectId} />
}
