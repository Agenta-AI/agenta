import {useCallback, useEffect, useRef, useState} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {
    AGENT_TEMPLATES,
    templateBuilderMessage,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import type {AgentSetupSelection} from "@agenta/entities/workflow"
import {AgentSetupCard, useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {HomeOverview, UsageCard} from "@agenta/home-ui"
import type {SessionRowVm} from "@agenta/sessions/row"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {ArrowLeftIcon} from "@phosphor-icons/react"
import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import NewAgentButton from "@/oss/components/NewAgentButton"
import NextTriggersSection from "@/oss/components/NextTriggers"
import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import SessionAutomationDrawers from "@/oss/components/pages/sessions/components/SessionAutomationDrawers"
import TemplateStrip from "@/oss/components/TemplateStrip"
import StripComposer from "@/oss/components/TemplateStrip/components/StripComposer"
import {
    DEFAULT_COMPOSER_CLASS,
    useTemplateProvenance,
} from "@/oss/components/TemplateStrip/hooks/useTemplateProvenance"
import useURL from "@/oss/hooks/useURL"
import {layoutFullHeightRequestAtom} from "@/oss/state/layout/fullHeight"

import {agentNameFromTask} from "./assets/agentName"
import {CONNECT_STEP_MODE, HERO, RETURNING_HERO, TEMPLATE_HERO} from "./assets/constants"
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
 * first run is this app's copy of the create-an-agent surface, deliberately the same shape as
 * /m's: hero at the top, the template strip as the offer, the composer docked at the bottom
 * with the connect step's card inside its frame.
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

    // The create surface pins its composer to the BOTTOM of the frame (/m's shape), which needs
    // the layout's bounded full-height frame — the returning branch scrolls with the page. The
    // Layout has expected this request for Home all along; nothing ever sent it, so the frame
    // was never full-height and the bottom-docking (and the old `my-auto`) silently did nothing.
    const requestFullHeight = useSetAtom(layoutFullHeightRequestAtom)
    useEffect(() => {
        requestFullHeight(firstRun)
        return () => requestFullHeight(false)
    }, [firstRun, requestFullHeight])

    const templateParam = Array.isArray(router.query.template)
        ? router.query.template[0]
        : router.query.template

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

    // The pre-create connect step (#6043). `open` replaces create; everything else on this page
    // is untouched, so with the flag off the surface behaves exactly as it did.
    const setup = useAgentSetupStep()
    /**
     * The card's create gate and live selection, reported up (`onReadyChange`): the Create
     * button lives in the composer's trailing cluster (mobile parity — the step docks INSIDE
     * the composer), so the page must hold what the card alone knows when it is pressed.
     */
    const [stepReady, setStepReady] = useState(false)
    const stepSelectionRef = useRef<AgentSetupSelection | null>(null)

    /**
     * "Unedited" baseline for a seeded template prompt, captured FROM the editor's change
     * stream: Lexical applies fills asynchronously and reports plain text, so a baseline taken
     * on any other channel makes an untouched prompt read as edited.
     */
    const promptBaselineRef = useRef<string | null>(null)
    const baselinePendingRef = useRef(false)
    const [promptEdited, setPromptEdited] = useState(false)

    const seedComposer = useCallback((text: string) => {
        composerRef.current?.setMarkdown(text)
        baselinePendingRef.current = true
        promptBaselineRef.current = text
        setPromptEdited(false)
    }, [])

    const handleComposerText = useCallback(
        (text: string) => {
            provenance.onComposerTextChange?.(text)
            if (baselinePendingRef.current) {
                baselinePendingRef.current = false
                promptBaselineRef.current = text
                setPromptEdited(false)
                return
            }
            const baseline = promptBaselineRef.current
            if (baseline !== null) setPromptEdited(text.trim() !== baseline.trim())
        },
        [provenance.onComposerTextChange],
    )

    const handlePick = useCallback(
        (template: AgentStarterTemplate) => {
            // On the workspace home the composer runs tasks, so a pick here has no composer to
            // seed — it means "build this", which is the create surface's job.
            if (!firstRun) {
                void router.push(`${baseAppURL}?new=1&template=${template.key}`)
                return
            }
            // A template usually has something to connect — but not when the workspace is already
            // connected for it, and `open` says so. Falling through then is the whole point: the
            // pick still has to create the agent, or the click does nothing at all.
            if (
                CONNECT_STEP_MODE &&
                setup.open({
                    seedMessage: templateBuilderMessage(template),
                    name: template.name,
                    template,
                })
            ) {
                // The template's prompt lives in the editor, editable, while the card gates.
                setStepReady(false)
                seedComposer(templateBuilderMessage(template))
                return
            }
            void createFromTemplate(template)
        },
        [firstRun, router, baseAppURL, createFromTemplate, setup.open, seedComposer],
    )

    // Seed once PER TEMPLATE KEY: a boolean guard blocked every template after the first,
    // because this surface stays mounted across ?template= navigations.
    // The template this surface was opened for, if any — the hero speaks about it by name.
    const pickedTemplate = templateParam
        ? AGENT_TEMPLATES.find((entry) => entry.key === templateParam)
        : undefined
    // The template this surface is setting up, if any — an in-place strip pick carries it on the
    // draft, an arrival on the URL.
    const heroTemplate = setup.draft?.template ?? pickedTemplate
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
        // A template arriving on the URL was picked on another page, so it goes straight to the
        // step — docked inside the composer, with the template's prompt seeded into the editor.
        if (!CONNECT_STEP_MODE) return
        if (
            setup.open({
                seedMessage: templateBuilderMessage(template),
                name: template.name,
                template,
            })
        ) {
            setStepReady(false)
            seedComposer(templateBuilderMessage(template))
        }
    }, [templateParam, provenance.pick, setup.open, seedComposer])

    // Create, with the step's answers. The editor holds the prompt (the template's, or the
    // typed one, still editable under the docked card), so what is IN it is what gets sent.
    const handleCreateFromSetup = useCallback(
        async (selection: AgentSetupSelection) => {
            if (loading || !setup.draft) return
            const text = composerRef.current?.getMarkdown().trim() || setup.draft.seedMessage
            setLoading(true)
            const ok = await onCreate(setup.draft.name, text, selection)
            if (!ok) setLoading(false)
        },
        [loading, onCreate, setup.draft],
    )

    const handleCreate = useCallback(
        async (markdown?: string) => {
            if (loading) return
            // The step is open: Enter and the Create button both mean what the gate allows —
            // create with the step's selection once the required connections are made.
            if (setup.draft) {
                if (stepReady && stepSelectionRef.current) {
                    // Enter cleared the editor; put the prompt back before the create reads it.
                    if (markdown?.trim()) seedComposer(markdown)
                    await handleCreateFromSetup(stepSelectionRef.current)
                }
                return
            }
            // Connect step on: describing an agent opens the step instead of creating. The
            // composer cleared itself on Enter, so the text goes straight back — the editor
            // stays on screen under the docked card.
            const message = (markdown ?? composerRef.current?.getMarkdown() ?? "").trim()
            // Nothing to ask for — nothing detected, or the workspace is already connected — so
            // the description creates the agent directly instead of stopping at an empty card.
            if (
                CONNECT_STEP_MODE &&
                message &&
                setup.open({
                    seedMessage: message,
                    name:
                        provenance.resolveTemplateName() || agentNameFromTask(message) || undefined,
                })
            ) {
                setStepReady(false)
                seedComposer(message)
                return
            }
            if (CONNECT_STEP_MODE && !message) return
            setLoading(true)
            const ok = await onCreate(provenance.resolveTemplateName(), markdown)
            if (!ok) setLoading(false)
        },
        [
            loading,
            onCreate,
            provenance.resolveTemplateName,
            setup.open,
            setup.draft,
            stepReady,
            seedComposer,
            handleCreateFromSetup,
            composerRef,
        ],
    )

    // Back to the offer. A dismissed template arrival also drops `?template=` so the hero stops
    // naming it, and clears a seeded prompt the user never edited; a typed description stays.
    const handleDismissStep = useCallback(() => {
        if (setup.draft?.template && !promptEdited) composerRef.current?.setMarkdown("")
        setup.close()
        setStepReady(false)
        if (templateParam) {
            seededTemplate.current = null
            void router.replace(creatingAgent ? `${baseAppURL}?new=1` : baseAppURL, undefined, {
                shallow: true,
            })
        }
    }, [setup.draft, setup.close, promptEdited, templateParam, creatingAgent, baseAppURL, router])

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
        // `pb-0` overrides the gutter's own pb-8 (tailwind-merge, className last): the layout's
        // full-height calc already reserves ~29px below this frame, and the composer must sit on
        // the frame's edge to read bottom-docked — measured 69px of stacked moat without it.
        <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0 pb-0")}>
            {/* The gutters and the shared column come from `PageLayout` (#5836), so Home sits in
                the same column as Agents, Sessions and the overview. Only the composer's own
                narrower measure is stated here. */}
            <div className="mx-auto box-border flex w-full min-h-0 max-w-[1040px] flex-1 flex-col overflow-y-auto">
                {/* The /m create surface's shape, exactly: the question at the top, then the
                    offer and the composer docked at the BOTTOM of the frame — `min-h-full` +
                    the flex spacer is what pins them there instead of letting the column float
                    mid-page. */}
                {/* `box-border` is load-bearing: preflight is off, so without it `min-h-full`
                    sizes the CONTENT box and `pt-8` is ADDED on top — the column outgrows the
                    frame and the docked composer is pushed below its edge. No `pb-*`: the
                    composer sits on the frame's own bottom. */}
                <div className="mx-auto box-border flex w-full min-h-full max-w-[840px] flex-1 flex-col pt-8">
                    {creatingAgent && !isFirstRun ? (
                        <Link
                            href={baseAppURL}
                            className="mb-6 inline-flex items-center gap-1 self-start text-xs !text-colorTextSecondary"
                        >
                            <ArrowLeftIcon size={14} />
                            Back to home
                        </Link>
                    ) : null}
                    {/* Left-aligned, as on /m. A template hero DESCRIBES ("Turns merged PRs into
                        clean release notes.") — the build prompt sits in the editor below,
                        editable, not repeated here. */}
                    <div className="flex flex-col gap-2">
                        <Typography.Title level={2} className="!m-0 !leading-tight !text-[30px]">
                            {heroTemplate ? TEMPLATE_HERO.title(heroTemplate.name) : HERO.title}
                        </Typography.Title>
                        <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                            {heroTemplate ? heroTemplate.description : HERO.subtitle}
                        </Typography.Text>
                    </div>

                    {/* Pushes everything below to the bottom of the frame, as /m does. */}
                    <div className="min-h-6 flex-1" />

                    {/* The offer sits ABOVE the composer, as on /m — it folds rather than
                        vanishing, so the swap with the docked card below reads as one motion. */}
                    <HeightCollapse open={!setup.draft} fade>
                        <TemplateStrip
                            className="pb-6"
                            surface="home"
                            layout="grid"
                            selectedTemplateKey={provenance.selectedTemplateKey}
                            onPick={handlePick}
                            pendingTemplateKey={pendingKey}
                        />
                    </HeightCollapse>

                    {/* Chip docks into this gap (bottom-full), so it can only tighten so far.
                        The 2px nudge + z-10 overlap and paint above the composer's top border
                        so the chip reads as one shape, not a seam. */}
                    <div className="relative flex flex-col items-stretch">
                        {/* The card names the template itself while the step is open, so the
                                chip stands down rather than saying it twice. */}
                        {setup.draft ? null : (
                            <div className="absolute bottom-full left-0 z-10 translate-y-[2px]">
                                {provenance.chipNode}
                            </div>
                        )}
                        {/* The composer NEVER unmounts (mobile parity): the connect step
                                docks inside its frame, the editor keeps the prompt editable, and
                                only Create is gated on the step's required connections. */}
                        <StripComposer
                            composerRef={composerRef}
                            onCreate={handleCreate}
                            // No chip is docked while the step is open, so the composer
                            // drops the chip's squared corner and primary-colored ring —
                            // that treatment exists to bind a chip to this frame, and
                            // without one it just shouts.
                            composerClassName={
                                setup.draft ? DEFAULT_COMPOSER_CLASS : provenance.composerClassName
                            }
                            onTextChange={handleComposerText}
                            loading={loading}
                            createDisabled={Boolean(setup.draft) && !stepReady}
                            onResetPrompt={
                                setup.draft?.template && promptEdited
                                    ? () => {
                                          const template = setup.draft?.template
                                          if (template)
                                              seedComposer(templateBuilderMessage(template))
                                      }
                                    : undefined
                            }
                            header={
                                // Collapsed, not conditionally mounted: the card must still
                                // be there during the fold (`step.accounts` survives
                                // `close()`), or the height snaps shut the frame it closes.
                                <HeightCollapse open={Boolean(setup.draft)} fade>
                                    {setup.accounts.length > 0 ? (
                                        <AgentSetupCard
                                            variant="docked"
                                            hideCreate
                                            className="text-left"
                                            accounts={setup.accounts}
                                            suggestions={setup.suggestions}
                                            onAddAccount={setup.addAccount}
                                            // Unused (`hideCreate`) — the composer's button
                                            // creates, below.
                                            onCreate={() => undefined}
                                            onReadyChange={(canCreate, selection) => {
                                                setStepReady(canCreate)
                                                stepSelectionRef.current = selection
                                            }}
                                            onDismiss={loading ? undefined : handleDismissStep}
                                            creating={loading}
                                        />
                                    ) : null}
                                </HeightCollapse>
                            }
                        />
                    </div>
                </div>
            </div>
            <SessionAutomationDrawers />
        </PageLayout>
    )
}

export default StripHome
