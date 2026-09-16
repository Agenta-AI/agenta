import {agentTemplateByKey} from "@agenta/entities/workflow"
import {TemplateDetail} from "@agenta/home-ui"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AssistantMarkdown} from "../chat/AssistantMarkdown"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"

/**
 * One template, in full — the SHARED detail view (the desktop page renders the same one), under
 * this app's screen shape.
 *
 * What stays here is this app's: `ScreenScaffold fill` (the view owns its scrolling), Streamdown
 * for AGENTS.md, and what "Use this template" does — it lands on the create surface
 * (`/agents/new?template=`), where the connect step takes the template strip's place. Every new
 * agent starts on that one structure; this page only browses.
 */
export const AgentTemplateDetailScreen = ({
    workspaceId,
    projectId,
    templateKey,
}: {
    workspaceId: string
    projectId: string
    templateKey: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const template = agentTemplateByKey(templateKey)

    return (
        <>
            <PageTitle title="Templates" context={template?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold fill>
                    <TemplateDetail
                        template={template}
                        allTemplatesHref={`${base}/templates`}
                        onUseTemplate={(picked) =>
                            void router.push(`${base}/agents/new?template=${picked.key}`)
                        }
                        renderMarkdown={(markdown) => (
                            <AssistantMarkdown streaming={false} text={markdown} />
                        )}
                    />
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
