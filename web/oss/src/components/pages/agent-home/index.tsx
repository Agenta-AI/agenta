import {useCallback, useRef, useState} from "react"

import {appTemplatesQueryAtom, createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {PageLayout} from "@agenta/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import {urlAtom} from "@/oss/state/url"

import {HERO, TUTORIAL_VIDEO} from "./assets/constants"
import type {AgentTemplate} from "./assets/templates"
import AgentComposer from "./components/AgentComposer"
import OnRamps from "./components/OnRamps"
import TemplateSetupDrawer, {type TemplateSetupResult} from "./components/TemplateSetupDrawer"
import TemplatesSection from "./components/TemplatesSection"
import TutorialVideoEmbed from "./components/TutorialVideoEmbed"
import UsageSummary from "./components/UsageSummary"
import YourAgentsTable from "./components/YourAgentsTable"
import {useAgentHomeActions} from "./hooks/useAgentHomeActions"
import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"

const AgentHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    const {onCreate, onContinueInIde} = useAgentHomeActions(composerRef)
    const {firstRunOverride} = useAgentHomeVariants()
    const {message} = App.useApp()
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)
    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)

    // Warm the app-templates cache so the ephemeral-create factory resolves the agent template.
    useAtomValue(appTemplatesQueryAtom)

    const handleBrowseAll = useCallback(() => {
        if (baseAppURL) router.push(`${baseAppURL}/agent-templates`)
    }, [baseAppURL, router])

    // First-run vs returning is driven by agent count (0 → first-run); ?firstRun overrides it.
    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentsLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const firstRun = firstRunOverride ?? (!agentsLoading && agents.length === 0)

    // First-run only: a tutorial video sits beside the composer (hidden when unconfigured).
    const showVideo = firstRun && !!TUTORIAL_VIDEO

    // Template card click opens the setup drawer (review + connect before Create).
    const [setupTemplate, setSetupTemplate] = useState<AgentTemplate | null>(null)

    // Create a real ephemeral agent (named from the drawer) and open it in the playground
    // drawer to commit — mirrors the Agents page create flow. Template-specific config
    // (instructions/model/tools) seeding is a follow-up; today it starts from the agent preset.
    const handleTemplateCreate = useCallback(
        async ({name}: TemplateSetupResult) => {
            try {
                const entityId = await createEphemeralAppFromTemplate({
                    type: "agent",
                    defaultName: name,
                })
                if (!entityId) {
                    message.error("Couldn't start agent creation — please retry")
                    return
                }
                setSetupTemplate(null)
                setOpenDrawer({entityId, context: "app-create"})
            } catch (error) {
                message.error(extractApiErrorMessage(error))
            }
        },
        [message, setOpenDrawer],
    )

    return (
        <PageLayout className="grow min-h-0">
            <div
                className={`mx-auto flex w-full flex-col gap-12 pb-16 pt-8 ${
                    showVideo ? "max-w-[1180px]" : firstRun ? "max-w-[680px]" : "max-w-[960px]"
                }`}
            >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-6 lg:max-w-[660px]">
                        <div className="flex flex-col gap-3">
                            {firstRun ? (
                                <div className="flex items-center gap-2">
                                    <Tag
                                        color="processing"
                                        className="!m-0 !rounded !px-1.5 !py-0 !text-[10px] !font-semibold !uppercase !leading-5"
                                    >
                                        {HERO.eyebrowNew}
                                    </Tag>
                                    <span className="text-xs font-medium text-[var(--ag-colorTextSecondary)]">
                                        {HERO.eyebrowLabel}
                                    </span>
                                </div>
                            ) : null}
                            <Typography.Title
                                level={2}
                                className="!m-0 !text-[30px] !leading-tight"
                            >
                                {HERO.title}
                            </Typography.Title>
                            <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                                {HERO.subtitle}
                            </Typography.Text>
                        </div>

                        <AgentComposer
                            composerRef={composerRef}
                            onCreate={onCreate}
                            onContinueInIde={onContinueInIde}
                        />
                    </div>

                    {showVideo && TUTORIAL_VIDEO ? (
                        <TutorialVideoEmbed
                            video={TUTORIAL_VIDEO}
                            className="w-full shrink-0 lg:w-[480px]"
                        />
                    ) : null}
                </div>

                {firstRun ? (
                    <>
                        <TemplatesSection
                            onSelectTemplate={setSetupTemplate}
                            onBrowseAll={handleBrowseAll}
                        />
                        <OnRamps />
                    </>
                ) : (
                    <>
                        <UsageSummary />
                        <YourAgentsTable />
                    </>
                )}
            </div>

            <TemplateSetupDrawer
                template={setupTemplate}
                open={!!setupTemplate}
                onClose={() => setSetupTemplate(null)}
                onCreate={handleTemplateCreate}
            />
        </PageLayout>
    )
}

export default AgentHome
