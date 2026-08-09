import {useCallback, useEffect, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {PanelScroll, PanelSurface} from "@agenta/ui/components/presentational"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {ArrowLeftIcon} from "@phosphor-icons/react"
import {App, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import NewAgentButton from "@/oss/components/NewAgentButton"
import NextTriggersSection from "@/oss/components/NextTriggers"
import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import TemplateStrip from "@/oss/components/TemplateStrip"
import {buildCodingAgentClipboard} from "@/oss/components/TemplateStrip/assets/codingAgentClipboard"
import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import CopiedToast from "@/oss/components/TemplateStrip/components/CopiedToast"
import StripComposer from "@/oss/components/TemplateStrip/components/StripComposer"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import UsageSummary from "@/oss/components/UsageSummary"
import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {HERO, RETURNING_HERO} from "./assets/constants"
import {captureFirstAgentIntent, truncateForCapture} from "./assets/onboardingAnalytics"
import {AGENT_TEMPLATES, type AgentTemplate} from "./assets/templates"
import HomeAutomationsSection from "./components/HomeAutomationsSection"
import HomeSessionsSection from "./components/HomeSessionsSection"
import HomeTaskComposer from "./components/HomeTaskComposer"
import YourAgentsTable from "./components/YourAgentsTable"
import {useAgentHomeActions} from "./hooks/useAgentHomeActions"
import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"

/**
 * The strip-era home layout (TEMPLATE_STRIP_MODE on): hero + composer (chip-docked) +
 * TemplateStrip + (returning users) the one-line Usage card and agents table. Replaces the
 * grid/drawer/IDE-modal flows entirely on this surface; those stay behind flag-off.
 */
// Hidden, not removed: the rail felt crowded with four sections, and templates already have
// the gallery + first-run grid. Flip back on to restore the rail card.
const SHOW_RAIL_TEMPLATES = false

const StripHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    // Home creates, navigates to the playground, and auto-sends (owner decision).
    const {onCreate} = useAgentHomeActions(composerRef, {autoSendSeed: true})
    const {firstRunOverride, creatingAgent} = useAgentHomeVariants()
    const posthog = usePostHogAg()
    const {baseAppURL} = useURL()
    const router = useRouter()
    const {message} = App.useApp()
    const [toastOpen, setToastOpen] = useState(false)
    // Create is a multi-step async round-trip; on success we navigate away, so we keep the
    // spinner running (only reset on failure) rather than flashing the label back mid-navigation.
    const [loading, setLoading] = useState(false)

    // Warm the app-templates cache so the ephemeral-create factory resolves the agent template.
    useAtomValue(appTemplatesQueryAtom)

    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentsLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const isFirstRun = firstRunOverride ?? (!agentsLoading && agents.length === 0)
    // The create-an-agent surface IS the first-run surface — describe it, pick a template, send.
    // A returning user gets there via `?new=1` rather than through the task composer.
    const firstRun = isFirstRun || creatingAgent

    const provenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => composerRef.current?.setMarkdown(text),
            getText: () => composerRef.current?.getMarkdown() ?? "",
        },
    })

    const handlePick = useCallback(
        (template: AgentTemplate) => {
            // On the workspace home the composer runs tasks, so a pick here has no composer to
            // seed — it means "build this", which is the create surface's job.
            if (!firstRun) {
                void router.push(`${baseAppURL}?new=1&template=${template.key}`)
                return
            }
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
        [firstRun, router, baseAppURL, provenance.pick, posthog],
    )

    // Seed once PER TEMPLATE KEY: a boolean guard blocked every template after the first,
    // because this surface stays mounted across ?template= navigations.
    const seededTemplate = useRef<string | null>(null)
    const templateParam = Array.isArray(router.query.template)
        ? router.query.template[0]
        : router.query.template
    useEffect(() => {
        if (!templateParam) {
            seededTemplate.current = null
            return
        }
        if (seededTemplate.current === templateParam) return
        const template = AGENT_TEMPLATES.find((entry) => entry.key === templateParam)
        if (!template) return
        seededTemplate.current = templateParam
        provenance.pick(template)
    }, [templateParam, provenance.pick])

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
        <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")}>
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
                        ? "mx-auto flex w-full min-h-0 max-w-[1040px] flex-1 flex-col overflow-y-auto"
                        : "flex min-h-0 w-full flex-1 gap-10 overflow-hidden"
                }
            >
                <div
                    className={
                        firstRun
                            ? "flex w-full flex-col"
                            : // `min-w-0` or a wide table would push the column past its share.
                              "box-border flex min-w-0 flex-1 flex-col gap-14 overflow-y-auto pr-4"
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
                        {creatingAgent && !isFirstRun ? (
                            <Link
                                href={baseAppURL}
                                className="mb-6 inline-flex items-center gap-1 self-start text-xs !text-colorTextSecondary"
                            >
                                <ArrowLeftIcon size={14} />
                                Back to home
                            </Link>
                        ) : null}
                        <div
                            className={
                                firstRun
                                    ? "flex flex-col items-center gap-4 text-center"
                                    : // The hero line carries the page's standing action. On its
                                      // own row above everything it cost a full band of empty
                                      // width and pushed the question it belongs beside downward.
                                      "flex items-center justify-between gap-4"
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
                            {!firstRun ? <NewAgentButton /> : null}
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
                                <HomeTaskComposer />
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
                        // Bare, on the page background: the rail is the page's one defined
                        // object, and a second sheet opposite it made both read as equal weight.
                        <div className="mt-10 flex flex-col gap-10">
                            <HomeSessionsSection limit={6} />
                            <HomeAutomationsSection />
                        </div>
                    )}
                </div>

                {/* Right column, post-swap: what you could start. Scrolls on its own.

                    A third of the width rather than a fixed 400px, which held its proportion
                    only at one screen size — it read as a third on a large display and as a
                    slab on a laptop. */}
                {!firstRun ? (
                    <div className="box-border flex min-h-0 w-1/3 min-w-[340px] max-w-[520px] shrink-0 grow-0 flex-col pr-1">
                        <PanelSurface>
                            <PanelScroll>
                                {/* Rows, not the scroller: a 238px card and a six-tab category
                                    row both need width this column doesn't have. */}
                                {SHOW_RAIL_TEMPLATES ? (
                                    <TemplateStrip
                                        surface="home"
                                        layout="list"
                                        selectedTemplateKey={provenance.selectedTemplateKey}
                                        onPick={handlePick}
                                    />
                                ) : null}
                                <YourAgentsTable variant="list" />
                                {/* Forward-looking, unlike the automation RUNS in the main column:
                                    a schedule that stopped firing is invisible in a list of things
                                    that already happened. */}
                                <NextTriggersSection />
                                {/* Usage sits with what you could start, not with what is in
                                    flight — it is the column you glance at, not work from. */}
                                <UsageSummary variant="strip" />
                            </PanelScroll>
                        </PanelSurface>
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
