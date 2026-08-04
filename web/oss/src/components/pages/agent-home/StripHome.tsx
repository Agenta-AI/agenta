import {useCallback, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App, Typography} from "antd"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {buildCodingAgentClipboard} from "@/oss/components/TemplateStrip/assets/codingAgentClipboard"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import CopiedToast from "@/oss/components/TemplateStrip/components/CopiedToast"
import StripComposer from "@/oss/components/TemplateStrip/components/StripComposer"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {HERO, RETURNING_HERO} from "./assets/constants"
import {captureFirstAgentIntent, truncateForCapture} from "./assets/onboardingAnalytics"
import {type AgentTemplate} from "./assets/templates"
import HomeAutomationsSection from "./components/HomeAutomationsSection"
import HomeSessionsSection from "./components/HomeSessionsSection"
import HomeTaskComposer from "./components/HomeTaskComposer"
import UsageSummary from "./components/UsageSummary"
import YourAgentsTable from "./components/YourAgentsTable"
import {useAgentHomeActions} from "./hooks/useAgentHomeActions"
import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"

/**
 * The strip-era home layout (TEMPLATE_STRIP_MODE on): hero + composer (chip-docked) +
 * TemplateStrip + (returning users) the one-line Usage card and agents table. Replaces the
 * grid/drawer/IDE-modal flows entirely on this surface; those stay behind flag-off.
 */
const StripHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    // Home creates, navigates to the playground, and auto-sends (owner decision).
    const {onCreate} = useAgentHomeActions(composerRef, {autoSendSeed: true})
    const {firstRunOverride} = useAgentHomeVariants()
    const posthog = usePostHogAg()
    const {message} = App.useApp()
    const [toastOpen, setToastOpen] = useState(false)
    // Create is a multi-step async round-trip; on success we navigate away, so we keep the
    // spinner running (only reset on failure) rather than flashing the label back mid-navigation.
    const [loading, setLoading] = useState(false)

    // Warm the app-templates cache so the ephemeral-create factory resolves the agent template.
    useAtomValue(appTemplatesQueryAtom)

    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentsLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const firstRun = firstRunOverride ?? (!agentsLoading && agents.length === 0)

    const provenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => composerRef.current?.setMarkdown(text),
            getText: () => composerRef.current?.getMarkdown() ?? "",
        },
    })

    const handlePick = useCallback(
        (template: AgentTemplate) => {
            provenance.pick(template)
            captureFirstAgentIntent(posthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "strip",
                    surface: "home",
                },
                intentValue: template.category || template.name,
            })
        },
        [provenance.pick, posthog],
    )

    const handleCreate = useCallback(
        async (markdown?: string) => {
            if (loading) return
            setLoading(true)
            const ok = await onCreate(provenance.resolveTemplateName(), markdown)
            if (!ok) setLoading(false)
        },
        [loading, onCreate, provenance.resolveTemplateName],
    )

    const handleCodingAgentCopy = useCallback(async () => {
        const text = composerRef.current?.getMarkdown().trim() ?? ""
        try {
            await navigator.clipboard.writeText(buildCodingAgentClipboard(text))
            setToastOpen(true)
        } catch {
            message.error("Couldn't copy — copy it manually")
            return
        }
        captureFirstAgentIntent(posthog, {
            source: "composer",
            properties: {action: "coding_agent_copy", message: truncateForCapture(text)},
        })
    }, [message, posthog])

    return (
        <PageLayout className="grow min-h-0">
            {/* First run stays a centered document — one question, one answer, nothing to
                resume yet. A returning user gets a workspace: two columns that fill the
                viewport and scroll independently, so starting work and resuming it are both
                always on screen instead of one being scrolled past. */}
            <div
                className={
                    firstRun
                        ? "mx-auto flex w-full max-w-[1040px] flex-col px-6 pb-20 pt-14"
                        : "flex h-[calc(100dvh-75px)] w-full gap-6 overflow-hidden px-6 pb-6 pt-8"
                }
            >
                <div
                    className={
                        firstRun
                            ? "flex w-full flex-col"
                            : // `min-w-0` or a wide table would push the column past its share.
                              "flex min-w-0 flex-1 flex-col gap-14 overflow-y-auto pr-1"
                    }
                >
                    <div
                        className={
                            firstRun
                                ? "mx-auto flex w-full max-w-[840px] flex-col"
                                : "flex w-full flex-col"
                        }
                    >
                        <div className="flex flex-col items-center gap-4 text-center">
                            <Typography.Title
                                level={2}
                                className="!m-0 !text-[30px] !leading-tight"
                            >
                                {firstRun ? HERO.title : RETURNING_HERO.title}
                            </Typography.Title>
                            <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                                {firstRun ? HERO.subtitle : RETURNING_HERO.subtitle}
                            </Typography.Text>
                        </div>

                        {/* Chip docks into the hero gap (bottom-full), so mt-11 holds with or without it.
                        The 2px nudge + z-10 overlap and paint above the composer's top border so the
                        chip reads as one shape, not a seam. */}
                        <div className="relative mt-11 flex flex-col items-stretch">
                            <div className="absolute bottom-full left-0 z-10 translate-y-[2px]">
                                {provenance.chipNode}
                            </div>
                            {/* First run has no agent to talk to, so the composer describes one to
                            create. Once agents exist, the daily action is starting a task with one
                            of them — creating another moves into the picker's footer. */}
                            {firstRun ? (
                                <StripComposer
                                    composerRef={composerRef}
                                    onCreate={handleCreate}
                                    onCodingAgentCopy={handleCodingAgentCopy}
                                    composerClassName={provenance.composerClassName}
                                    onTextChange={provenance.onComposerTextChange}
                                    loading={loading}
                                />
                            ) : (
                                <HomeTaskComposer
                                    onCreateAgent={(markdown) => void handleCreate(markdown)}
                                    creating={loading}
                                />
                            )}
                        </div>
                    </div>

                    {firstRun ? (
                        <TemplateStrip
                            className="mt-20"
                            surface="home"
                            layout="grid"
                            selectedTemplateKey={provenance.selectedTemplateKey}
                            onPick={handlePick}
                        />
                    ) : (
                        <>
                            {/* Returning users get the scroller, not the paged grid: here the
                                strip is a sample you glance at, and paging 28 templates three at
                                a time is a browsing control in a slot nobody came to browse. */}
                            <TemplateStrip
                                surface="home"
                                layout="scroll"
                                surfaceColorVar="--ag-colorBgLayout"
                                selectedTemplateKey={provenance.selectedTemplateKey}
                                onPick={handlePick}
                            />
                            <YourAgentsTable />
                        </>
                    )}
                </div>

                {/* Right column: what's in flight. Scrolls on its own so a long session list
                    never pushes the composer off screen. */}
                {!firstRun ? (
                    <div className="flex w-[400px] shrink-0 flex-col gap-6 overflow-y-auto pr-1">
                        <HomeSessionsSection limit={10} />
                        <HomeAutomationsSection />
                        <UsageSummary variant="strip" />
                    </div>
                ) : null}
            </div>

            <CopiedToast
                open={toastOpen}
                text={STRIP_COPY.copiedToast}
                onDone={() => setToastOpen(false)}
            />
        </PageLayout>
    )
}

export default StripHome
