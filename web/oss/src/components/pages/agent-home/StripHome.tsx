import {useCallback, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {App, Typography} from "antd"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import {PanelSurface} from "@/oss/components/PanelSection"
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
                resume yet — and scrolls inside the frame rather than moving the page. A
                returning user gets a workspace: two columns that fill the frame and scroll
                independently, so starting work and resuming it are both always on screen
                instead of one being scrolled past.

                Both fill the layout's own full-height frame (`isFullHeight`, which is what
                puts the `100dvh` calc on the content wrapper) instead of restating a viewport
                height here. Asserting one locally on a route the layout thinks is a normal
                flowing document gave the body its own scrollbar underneath the columns'. */}
            <div
                className={
                    firstRun
                        ? "mx-auto flex w-full min-h-0 max-w-[1040px] flex-1 flex-col overflow-y-auto px-6 pb-20 pt-14"
                        : "flex min-h-0 w-full flex-1 gap-6 overflow-hidden px-6 pb-6 pt-8"
                }
            >
                <div
                    className={
                        firstRun
                            ? "flex w-full flex-col"
                            : // `min-w-0` or a wide table would push the column past its share.
                              "box-border flex min-w-0 flex-1 flex-col gap-14 overflow-y-auto pr-1"
                    }
                >
                    <div
                        className={
                            firstRun
                                ? "mx-auto flex w-full max-w-[840px] flex-col"
                                : "flex w-full flex-col"
                        }
                    >
                        {/* First run centres: one column, nothing else on the page, and the
                            centred axis is the page's own. In the workspace that axis stops
                            existing — the left column is an asymmetric slice, and every other
                            block on the page (composer, Templates, the agents table, every rail
                            card) starts at its left edge. So here the hero joins that rag and
                            drops to a label's size: the composer is the invitation, and its
                            placeholder already asks the question the subtitle repeated. */}
                        <div
                            className={
                                firstRun
                                    ? "flex flex-col items-center gap-4 text-center"
                                    : "flex flex-col"
                            }
                        >
                            <Typography.Title
                                level={2}
                                className={`!m-0 !leading-tight ${
                                    firstRun ? "!text-[30px]" : "!text-[20px]"
                                }`}
                            >
                                {firstRun ? HERO.title : RETURNING_HERO.title}
                            </Typography.Title>
                            {firstRun ? (
                                <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                                    {HERO.subtitle}
                                </Typography.Text>
                            ) : null}
                        </div>

                        {/* Chip docks into this gap (bottom-full), so it can only tighten so far.
                        The 2px nudge + z-10 overlap and paint above the composer's top border so the
                        chip reads as one shape, not a seam. */}
                        <div
                            className={`relative flex flex-col items-stretch ${
                                firstRun ? "mt-11" : "mt-8"
                            }`}
                        >
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
                        // EXPERIMENT: the columns' contents are swapped. What's in flight takes
                        // the wide column under the composer; the templates strip and the agents
                        // roster move to the rail. The hero and composer stay put.
                        <PanelSurface className="mt-8 shrink-0 grow">
                            <HomeSessionsSection limit={10} />
                            <HomeAutomationsSection />
                            <UsageSummary variant="strip" />
                        </PanelSurface>
                    )}
                </div>

                {/* Right column, post-swap: what you could start. Scrolls on its own.

                    A third of the width rather than a fixed 400px, which held its proportion
                    only at one screen size — it read as a third on a large display and as a
                    slab on a laptop. */}
                {!firstRun ? (
                    <div className="box-border flex w-1/3 min-w-[340px] max-w-[520px] shrink-0 grow-0 flex-col gap-6 overflow-y-auto pr-1">
                        {/* Returning users get the scroller, not the paged grid: here the strip
                            is a sample you glance at, and paging 28 templates three at a time is
                            a browsing control in a slot nobody came to browse. */}
                        <TemplateStrip
                            surface="home"
                            layout="scroll"
                            surfaceColorVar="--ag-colorBgLayout"
                            selectedTemplateKey={provenance.selectedTemplateKey}
                            onPick={handlePick}
                        />
                        <YourAgentsTable />
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
