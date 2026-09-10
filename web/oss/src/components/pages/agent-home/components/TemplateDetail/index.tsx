import {agentTemplateByKey} from "@agenta/entities/workflow"
import {TemplateDetail as TemplateDetailView} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"
import {useRouter} from "next/router"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import useURL from "@/oss/hooks/useURL"

/**
 * One template, in full — the SHARED detail view under this app's page chrome.
 *
 * What stays here is this app's: the page frame, its markdown renderer for AGENTS.md, and what
 * "Use this template" does — it creates the agent and lands in its playground, rather than
 * bouncing back through the create surface to press the same button again.
 */
const TemplateDetail = ({templateKey}: {templateKey: string}) => {
    const {baseAppURL} = useURL()
    const router = useRouter()
    const template = agentTemplateByKey(templateKey)
    return (
        <PageLayout className="grow min-h-0 !p-0">
            <TemplateDetailView
                template={template}
                allTemplatesHref={`${baseAppURL}/agent-templates`}
                // The connect step lives where the composer does — bottom of the create surface,
                // in its place. This page has no composer, so the pick goes there.
                onUseTemplate={(pickedTemplate) =>
                    void router.push(`${baseAppURL}?new=1&template=${pickedTemplate.key}`)
                }
                renderMarkdown={(markdown) => (
                    <Markdown content={markdown} className="!text-[13px]" />
                )}
            />
        </PageLayout>
    )
}

export default TemplateDetail
