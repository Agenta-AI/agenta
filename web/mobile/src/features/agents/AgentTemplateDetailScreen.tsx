import {agentTemplateByKey} from "@agenta/entities/workflow"
import {TemplateDetail} from "@agenta/home-ui"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AssistantMarkdown} from "../chat/AssistantMarkdown"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"

import {useNewAgentAction} from "./useNewAgentAction"

/**
 * One template, in full — the SHARED detail view (the desktop page renders the same one), under
 * this app's screen shape.
 *
 * What stays here is this app's: `ScreenScaffold fill` (the view owns its scrolling), Streamdown
 * for AGENTS.md, and what "Use this template" does — the same seeded create the New agent menu
 * runs, landing in the new agent's first conversation.
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
    const base = `/w/${workspaceId}/p/${projectId}`
    const newAgent = useNewAgentAction(base)
    const template = agentTemplateByKey(templateKey)

    return (
        <>
            <PageTitle title="Templates" context={template?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    // Only while a create is failing — nothing renders at rest.
                    header={
                        newAgent.error ? (
                            <div className="border-border text-destructive shrink-0 border-b px-4 py-2 text-xs">
                                {newAgent.error}
                            </div>
                        ) : undefined
                    }
                >
                    <TemplateDetail
                        template={template}
                        allTemplatesHref={`${base}/templates`}
                        busy={newAgent.creating}
                        onUseTemplate={(picked) => newAgent.createFromTemplate(picked.key)}
                        renderMarkdown={(markdown) => (
                            <AssistantMarkdown streaming={false} text={markdown} />
                        )}
                    />
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
