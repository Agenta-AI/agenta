import {useEffect} from "react"

import {useRouter} from "next/router"

import {NewAgentScreen} from "@/features/agents/NewAgentScreen"
import {forgetTemplateKey} from "@/lib/context"

export default function NewAgentPage() {
    const router = useRouter()
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    const templateKey =
        typeof router.query.template === "string" && router.query.template
            ? router.query.template
            : undefined
    // The template the website link carried across sign-in has arrived; stop remembering it.
    useEffect(() => {
        if (templateKey) forgetTemplateKey()
    }, [templateKey])
    if (!workspaceId || !projectId) return null
    return (
        <NewAgentScreen workspaceId={workspaceId} projectId={projectId} templateKey={templateKey} />
    )
}
