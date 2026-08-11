import {useCallback, useEffect, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {AGENT_TEMPLATES, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {HomeOverview, UsageCard} from "@agenta/home-ui"
import type {SessionRowVm} from "@agenta/sessions/row"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {ArrowLeftIcon} from "@phosphor-icons/react"
import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import NewAgentButton from "@/oss/components/NewAgentButton"
import NextTriggersSection from "@/oss/components/NextTriggers"
import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import TemplateStrip from "@/oss/components/TemplateStrip"
import StripComposer from "@/oss/components/TemplateStrip/components/StripComposer"
import {useTemplateProvenance} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import useURL from "@/oss/hooks/useURL"

import {HERO, RETURNING_HERO} from "./assets/constants"
import HomeTaskComposer from "./components/HomeTaskComposer"
import YourAgentsTable from "./components/YourAgentsTable"
import {useAgentHomeActions} from "./hooks/useAgentHomeActions"
import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"
import {useCreateAgentFromTemplate} from "./hooks/useCreateAgentFromTemplate"

// The expanded analytics view is desktop-only (tremor charts) and lazy — the shared usage
// card takes it as a slot, so mobile simply has no Expand control.
const AnalyticsDashboard = dynamic(
    () => import("@/oss/components/pages/observability/dashboard/AnalyticsDashboard"),
)

const actionTargetFor = (vm: SessionRowVm) => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
})

/**
 * Home. A returning user gets the SHARED page (`@agenta/home-ui`) that mobile also renders;
 * first run stays this app's own centred create-an-agent document — templates and the
 * Lexical-backed create composer have no mobile counterpart yet.
 */
const StripHome: React.FC = () => {
    const composerRef = useRef<RichChatInputHandle>(null)
    // Home creates, navigates to the playground, and auto-sends (owner decision).
    const {onCreate} = useAgentHomeActions(composerRef, {autoSendSeed: true})
    const {firstRunOverride, creatingAgent} = useAgentHomeVariants()
    const {baseAppURL, projectURL} = useURL()
    const router = useRouter()
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

    const templateParam = Array.isArray(router.query.template)
        ? router.query.template[0]
        : router.query.template
    // "Blank agent" from the New agent menu asks for one thing: describe it. The templates below
    // were the answer to a question this path already declined, so the composer stands alone and
    // centres. First run and `?template=` still show them — there the strip is the offer.
    const blankCreate = creatingAgent && !templateParam

    const provenance = useTemplateProvenance({
        composerApi: {
            setText: (text) => composerRef.current?.setMarkdown(text),
            getText: () => composerRef.current?.getMarkdown() ?? "",
        },
    })

    // Desktop opens a session by deep-linking into the playground; the row menu is the
    // sessions-page action set. Both are this app's verbs, handed to the shared page.
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()

    const handleOpenSession = useCallback(
        (vm: SessionRowVm) => {
            if (vm.agentId)
                openSession({
                    appId: vm.agentId,
                    sessionId: vm.id,
                    title: vm.stream.name?.trim() || undefined,
                })
        },
        [openSession],
    )
    const sessionMenuFor = useCallback(
        (vm: SessionRowVm) =>
            sessionActions.menuItems(actionTargetFor(vm), {onOpen: () => handleOpenSession(vm)}),
        [sessionActions, handleOpenSession],
    )
    const onSessionMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) =>
            sessionActions.onMenuClick(actionTargetFor(vm), {
                onOpen: () => handleOpenSession(vm),
            })({key}),
        [sessionActions, handleOpenSession],
    )

    // A card here IS the create action — no composer step, no second confirmation.
    const {createFromTemplate, pendingKey} = useCreateAgentFromTemplate("create")

    const handlePick = useCallback(
        (template: AgentStarterTemplate) => {
            // On the workspace home the composer runs tasks, so a pick here has no composer to
            // seed — it means "build this", which is the create surface's job.
            if (!firstRun) {
                void router.push(`${baseAppURL}?new=1&template=${template.key}`)
                return
            }
            void createFromTemplate(template)
        },
        [firstRun, router, baseAppURL, createFromTemplate],
    )

    // Seed once PER TEMPLATE KEY: a boolean guard blocked every template after the first,
    // because this surface stays mounted across ?template= navigations.
    const seededTemplate = useRef<string | null>(null)
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

    // The returning-user page IS the shared one — hero, composer, in-flight column, rail — so
    // mobile and desktop render one composition. Only the pieces this app alone owns (its
    // composer, its analytics dashboard, its session verbs) are passed in.
    if (!firstRun) {
        return (
            // The same frame as first run, Agents and Sessions: `PageLayout` carries the gutters
            // and `pageContentWidthClass` the column cap, so Home is not the one page whose
            // content sits 300px wider than everything beside it.
            <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")}>
                <HomeOverview
                    title={RETURNING_HERO.title}
                    action={<NewAgentButton />}
                    composer={
                        <>
                            {/* Chip docks into this gap (bottom-full), so it can only tighten so
                                far. The 2px nudge + z-10 overlap and paint above the composer's
                                top border so the chip reads as one shape, not a seam. */}
                            <div className="absolute bottom-full left-0 z-10 translate-y-[2px]">
                                {provenance.chipNode}
                            </div>
                            <HomeTaskComposer />
                        </>
                    }
                    sessionsHref={`${projectURL}/sessions`}
                    onOpenSession={handleOpenSession}
                    sessionMenuFor={sessionMenuFor}
                    onSessionMenuSelect={onSessionMenuSelect}
                    agentsPanel={<YourAgentsTable variant="list" />}
                    triggersPanel={<NextTriggersSection />}
                    usagePanel={
                        <UsageCard
                            expandedContent={
                                <AnalyticsDashboard layout="stack" showTimeRangeSelector={false} />
                            }
                        />
                    }
                />
            </PageLayout>
        )
    }

    // First run stays a centered document — one question, one answer, nothing to resume yet —
    // and scrolls inside the frame rather than moving the page. It fills the layout's own
    // full-height frame (`isFullHeight`, which puts the `100dvh` calc on the content wrapper)
    // instead of restating a viewport height here: asserting one locally on a route the layout
    // thinks is a normal flowing document gave the body its own scrollbar underneath.
    return (
        <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")}>
            {/* The gutters and the shared column come from `PageLayout` (#5836), so Home sits in
                the same column as Agents, Sessions and the overview. Only the composer's own
                narrower measure is stated here. */}
            <div className="mx-auto flex w-full min-h-0 max-w-[1040px] flex-1 flex-col overflow-y-auto">
                {/* `my-auto` (not `justify-center`) so the block still centres when it outgrows
                    the frame without clipping its top out of the scroller. */}
                <div className={`flex w-full flex-col ${blankCreate ? "my-auto" : ""}`}>
                    <div className="mx-auto flex w-full max-w-[840px] flex-col">
                        {creatingAgent && !isFirstRun ? (
                            <Link
                                href={baseAppURL}
                                className="mb-6 inline-flex items-center gap-1 self-start text-xs !text-colorTextSecondary"
                            >
                                <ArrowLeftIcon size={14} />
                                Back to home
                            </Link>
                        ) : null}
                        {/* First run centres: one column, nothing else on the page, and the
                            centred axis is the page's own. */}
                        <div className="flex flex-col items-center gap-4 text-center">
                            <Typography.Title
                                level={2}
                                className="!m-0 !leading-tight !text-[30px]"
                            >
                                {HERO.title}
                            </Typography.Title>
                            <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                                {HERO.subtitle}
                            </Typography.Text>
                        </div>

                        {/* Chip docks into this gap (bottom-full), so it can only tighten so far.
                            The 2px nudge + z-10 overlap and paint above the composer's top border
                            so the chip reads as one shape, not a seam. */}
                        <div className="relative mt-11 flex flex-col items-stretch">
                            <div className="absolute bottom-full left-0 z-10 translate-y-[2px]">
                                {provenance.chipNode}
                            </div>
                            {/* First run has no agent to talk to, so the composer describes one to
                                create. Once agents exist the daily action is starting a task with
                                one of them — that composer lives on the shared Home above. */}
                            <StripComposer
                                composerRef={composerRef}
                                onCreate={handleCreate}
                                composerClassName={provenance.composerClassName}
                                onTextChange={provenance.onComposerTextChange}
                                loading={loading}
                            />
                        </div>
                    </div>

                    {blankCreate ? null : (
                        <TemplateStrip
                            className="mt-20"
                            surface="home"
                            layout="grid"
                            selectedTemplateKey={provenance.selectedTemplateKey}
                            onPick={handlePick}
                            pendingTemplateKey={pendingKey}
                        />
                    )}
                </div>
            </div>
        </PageLayout>
    )
}

export default StripHome
