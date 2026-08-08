import {agentTemplateByKey} from "@agenta/entities/workflow"
import {TemplateDetail as TemplateDetailView} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"
import {useRouter} from "next/router"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import useURL from "@/oss/hooks/useURL"

/**
 * One template, in full — the SHARED detail view under this app's page chrome.
 *
 * What stays here is this app's: the page frame, its markdown renderer for AGENTS.md, and where
 * "Use this template" goes (the create route, which seeds the playground from the template key).
 */
const TemplateDetail = ({templateKey}: {templateKey: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <TemplateDetailView
                template={agentTemplateByKey(templateKey)}
                allTemplatesHref={`${baseAppURL}/agent-templates`}
                onUseTemplate={(template) =>
                    void router.push(`${baseAppURL}?new=1&template=${template.key}`)
                }
                renderMarkdown={(markdown) => (
                    <Markdown content={markdown} className="!text-[13px]" />
                )}
            />
        </PageLayout>
    )
}

export default TemplateDetail
