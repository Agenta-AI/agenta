import {agentTemplateByKey} from "@agenta/entities/workflow"
import {TemplateDetail as TemplateDetailView} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import useURL from "@/oss/hooks/useURL"

import {useCreateAgentFromTemplate} from "../../hooks/useCreateAgentFromTemplate"

/**
 * One template, in full — the SHARED detail view under this app's page chrome.
 *
 * What stays here is this app's: the page frame, its markdown renderer for AGENTS.md, and what
 * "Use this template" does — it creates the agent and lands in its playground, rather than
 * bouncing back through the create surface to press the same button again.
 */
const TemplateDetail = ({templateKey}: {templateKey: string}) => {
    const {baseAppURL} = useURL()
    const {createFromTemplate, pendingKey} = useCreateAgentFromTemplate("template_detail")
    const template = agentTemplateByKey(templateKey)

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <TemplateDetailView
                template={template}
                allTemplatesHref={`${baseAppURL}/agent-templates`}
                busy={pendingKey === template?.key}
                onUseTemplate={(pickedTemplate) => void createFromTemplate(pickedTemplate)}
                renderMarkdown={(markdown) => (
                    <Markdown content={markdown} className="!text-[13px]" />
                )}
            />
        </PageLayout>
    )
}

export default TemplateDetail
