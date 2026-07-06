import {useCallback, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
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
import {useCreateAgent} from "./hooks/useCreateAgent"
import {useIdeHandoffModal} from "./hooks/useIdeHandoffModal"
import {useTemplateSelect} from "./hooks/useTemplateSelect"

const AgentHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    const {onCreate} = useAgentHomeActions(composerRef)
    // "Continue in IDE" opens the IDE-handoff modal with the current composer text (the default,
    // non-playground behavior; the experimental playground onboarding uses a streamed bubble instead).
    const ideModal = useIdeHandoffModal()
    const onContinueInIde = useCallback(
        () => ideModal.openWith(composerRef.current?.getMarkdown().trim() ?? ""),
        [ideModal],
    )
    const {firstRunOverride} = useAgentHomeVariants()
    const router = useRouter()
    const {baseAppURL, projectURL} = useAtomValue(urlAtom)
    const createAgent = useCreateAgent()

    // "Bring an existing app" → the observability page (send traces from existing code). "Explore a
    // demo project" has no wired destination yet, so it's left off and OnRamps hides that card.
    const onBringApp = useCallback(() => {
        if (projectURL) router.push(`${projectURL}/observability`)
    }, [projectURL, router])

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

    // Template card click: builder mode → straight to a seeded playground; else open the setup
    // drawer (review + connect before Create). Gated by NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER.
    const [setupTemplate, setSetupTemplate] = useState<AgentTemplate | null>(null)
    const handleSelectTemplate = useTemplateSelect(setSetupTemplate)

    // Create the agent from the template and land in its playground (no drawer). The template's
    // seed message pre-fills the playground composer; connect-a-model is handled there. The setup
    // drawer stays open (showing its Create spinner) until navigation succeeds or an error surfaces.
    const handleTemplateCreate = useCallback(
        async ({template, name}: TemplateSetupResult) => {
            await createAgent({name, seedMessage: template.seedMessage})
        },
        [createAgent],
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
                            onSelectTemplate={handleSelectTemplate}
                            onBrowseAll={handleBrowseAll}
                        />
                        <OnRamps onBringApp={onBringApp} />
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
            {ideModal.node}
        </PageLayout>
    )
}

export default AgentHome
