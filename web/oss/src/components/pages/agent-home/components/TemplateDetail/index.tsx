import {agentTemplateByKey, templateBuilderMessage} from "@agenta/entities/workflow"
import {AgentSetupCard, useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {TemplateDetail as TemplateDetailView} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import {CONNECT_STEP_MODE} from "@/oss/components/pages/agent-home/assets/constants"
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
    // The connect step lives here rather than on the create surface: "Use this template" builds
    // the agent and opens the playground, so sending the pick elsewhere to be re-submitted was
    // the wrong shape. `open` declining means there is nothing to ask.
    const setup = useAgentSetupStep()

    return (
        <PageLayout className="grow min-h-0 !p-0">
            {setup.draft ? (
                <div className="mx-auto w-full max-w-[720px] px-4 py-6">
                    <AgentSetupCard
                        accounts={setup.accounts}
                        suggestions={setup.suggestions}
                        skippedSlugs={setup.skippedSlugs}
                        onSkip={setup.skip}
                        onUndoSkip={setup.undoSkip}
                        onAddAccount={setup.addAccount}
                        permission={setup.permission}
                        onPermissionChange={setup.setPermission}
                        creating={pendingKey === template?.key}
                        onCreate={(selection) => {
                            if (!template) return
                            void createFromTemplate(template, selection)
                        }}
                    />
                </div>
            ) : (
                <TemplateDetailView
                    template={template}
                    allTemplatesHref={`${baseAppURL}/agent-templates`}
                    onUseTemplate={(pickedTemplate) => {
                        if (
                            CONNECT_STEP_MODE &&
                            setup.open({
                                seedMessage: templateBuilderMessage(pickedTemplate),
                                name: pickedTemplate.name,
                                template: pickedTemplate,
                            })
                        ) {
                            return
                        }
                        void createFromTemplate(pickedTemplate)
                    }}
                    renderMarkdown={(markdown) => (
                        <Markdown content={markdown} className="!text-[13px]" />
                    )}
                />
            )}
        </PageLayout>
    )
}

export default TemplateDetail
