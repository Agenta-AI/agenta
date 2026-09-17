import {useEffect, useRef, useState} from "react"

import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {markSessionFresh} from "@agenta/chat/state"
import {
    agentTemplateByKey,
    templateBuilderMessage,
    type AgentSetupSelection,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {AgentSetupCard, useAgentSetupStep} from "@agenta/entity-ui/onboarding"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useRouter} from "next/router"

import {CONNECT_STEP_MODE} from "@/lib/connectStep"
import {newId} from "@/lib/ids"

import {useNewAgentAction} from "../agents/useNewAgentAction"
import {SessionWorkspace} from "../chat/SessionWorkspace"

import {FIRST_RUN_COPY} from "./copy"
import {FirstRunComposer} from "./FirstRunComposer"
import {FirstRunTemplates} from "./FirstRunTemplates"
import {useEphemeralAgent} from "./useEphemeralAgent"

/**
 * The create-an-agent surface: what a brand-new project shows instead of Home, and where every
 * "New agent" entry lands (`/agents/new`, optionally `?template=<key>`).
 *
 * Home is the wrong first screen for someone with nothing: it asks "What do you want to do?" and
 * its composer runs a task with an agent that already exists, so with none it disables itself and
 * leaves one button on an empty page.
 *
 * Like the desktop, this mounts the REAL workspace around a local-only agent minted up front, so
 * the config pane (model, instructions, tools) is live before anything is created — you can see
 * and change what you are about to build. The conversation half is replaced by the create surface
 * until the agent exists; submitting commits that same ephemeral rather than minting a second one.
 *
 * One structure, two offers: blank create shows the template strip; a template pick (here, or a
 * `?template=` arrival from any other page) folds the strip away and docks the connect step's
 * card inside the composer, while the hero names the template with its own prompt as the
 * subtitle. The editor holds that same prompt and stays editable throughout — only the Create
 * action is gated on the step's required connections.
 */
export const FirstRunScreen = ({
    base,
    workspaceId,
    projectId,
    templateKey,
}: {
    base: string
    workspaceId: string
    projectId: string
    /** A pick made on another page (`?template=`): the step opens on landing. */
    templateKey?: string
}) => {
    const newAgent = useNewAgentAction(base)
    const router = useRouter()
    const step = useAgentSetupStep()
    const {entityId, error: mintError, retry} = useEphemeralAgent(true)
    const inputRef = useRef<RichChatInputHandle | null>(null)

    // One session id for the whole pre-commit surface: the composer stages attachments against it
    // and the workspace keys its panes off it, so they must agree before the agent exists.
    const [sessionId] = useState(() => {
        const id = newId()
        markSessionFresh(id)
        return id
    })
    const attachments = useComposerAttachments({sessionId})

    /**
     * Text parked for the editor. `ChatComposer` clears itself on submit, and a seed can arrive
     * before a render that has the editor's ref — so writes go through state and land in the
     * effect below, on the render after the editor is there to take them.
     */
    const [refill, setRefill] = useState<string | null>(null)
    /**
     * The "unedited" reference for the template prompt, captured FROM the editor's own change
     * event (plain text, the same channel every later comparison uses). Two traps live here:
     * Lexical applies `setMarkdown` asynchronously, so reading the editor back in the fill
     * effect returns the PRE-fill state — and `onChange` reports plain text, not markdown — so
     * any baseline taken outside the change stream makes an untouched prompt read as edited.
     */
    const promptBaselineRef = useRef<string | null>(null)
    /** The next change is the programmatic fill itself — record it, don't compare against it. */
    const baselinePendingRef = useRef(false)
    const [promptEdited, setPromptEdited] = useState(false)
    useEffect(() => {
        if (refill === null) return
        inputRef.current?.setMarkdown(refill)
        inputRef.current?.focus()
        baselinePendingRef.current = true
        // Provisional, for the (unmounted-editor) case where the fill never emits a change.
        promptBaselineRef.current = refill
        setPromptEdited(false)
        setRefill(null)
    }, [refill])

    const handlePromptChange = (text: string) => {
        if (baselinePendingRef.current) {
            baselinePendingRef.current = false
            promptBaselineRef.current = text
            setPromptEdited(false)
            return
        }
        const baseline = promptBaselineRef.current
        if (baseline === null) return
        setPromptEdited(text.trim() !== baseline.trim())
    }

    /**
     * The card's create gate, reported back up (`onReadyChange`) — it disables the Create button
     * in the composer until the required connections are made. The selection rides along: the
     * button lives outside the card (`hideCreate`), so the screen must hold what the card alone
     * knows at the moment it is pressed.
     */
    const [stepReady, setStepReady] = useState(false)
    const selectionRef = useRef<AgentSetupSelection | null>(null)

    /** Open the step for a template; its prompt carries the hero AND sits in the locked editor. */
    const openStepFor = (template: AgentStarterTemplate): boolean => {
        if (!CONNECT_STEP_MODE) return false
        const seed = templateBuilderMessage(template)
        if (!step.open({seedMessage: seed, name: template.name, template})) return false
        setStepReady(false)
        setRefill(seed)
        return true
    }

    const pickTemplate = (template: AgentStarterTemplate) => {
        if (openStepFor(template)) return
        newAgent.createFromTemplate(template.key)
    }

    // A `?template=` arrival was picked on another page, so the step opens on landing — once per
    // key, because this surface stays mounted across query-only navigations. `open` declining
    // means there is nothing to connect, and the navigation here already meant "use it".
    const arrivedTemplate = agentTemplateByKey(templateKey)
    const seededTemplate = useRef<string | null>(null)
    useEffect(() => {
        if (!arrivedTemplate) return
        if (seededTemplate.current === arrivedTemplate.key) return
        seededTemplate.current = arrivedTemplate.key
        if (openStepFor(arrivedTemplate)) return
        newAgent.createFromTemplate(arrivedTemplate.key)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [arrivedTemplate])

    const create = async (text: string, setup?: AgentSetupSelection) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        // The outcome comes back as a value, not off `newAgent.error`: that flag belongs to THIS
        // render, so reading it after the await would read the state from before the create.
        const handedOff = await newAgent.createFromPrompt({
            text,
            // A template pick names the agent; a plain description leaves naming to the agent.
            name: step.draft?.name,
            sessionId,
            parts,
            setup,
            // Commit the ephemeral the config pane has been editing, not a fresh one.
            entityId: entityId ?? undefined,
        })
        // Cleared only once the destination is committed to. A create that failed leaves the files
        // staged and still sendable, and reports itself through `newAgent.error` below.
        if (handedOff) {
            attachments.clearAttachments(staged.map((file) => file.uid))
            return
        }
        // A create from the step leaves the step open so the card (and `newAgent.error` below it)
        // can be retried — the description is still in the editor.
        if (setup) return
        // The input cleared itself on submit, so a failure would swallow the whole description.
        // Only refill an input the user has not started retyping in.
        if (!inputRef.current?.getMarkdown().trim()) setRefill(text)
    }

    // Back to the offer. A dismissed template arrival also drops `?template=` so the hero stops
    // naming it, and clears a template prompt the user never edited; a typed description stays
    // in the editor, still the user's to send.
    const dismissStep = () => {
        if (step.draft?.template && !promptEdited) setRefill("")
        step.close()
        if (templateKey) {
            seededTemplate.current = null
            void router.replace(`${base}/agents/new`, undefined, {shallow: true})
        }
    }

    // The template this surface is setting up, if any — the hero speaks about it by name.
    const template = step.draft?.template ?? arrivedTemplate ?? null

    /**
     * The strip's fold is sequenced against the card's. Opening the step reads smooth with both
     * moving at once (the strip folds away while the card grows elsewhere), but closing had the
     * strip's large unfold fighting the card's fold in the same instant — so on close the card
     * folds FIRST and the strip unfolds into the space it left. Half of HeightCollapse's own
     * 300ms, so the two motions overlap without starting together.
     */
    const hasDraft = Boolean(step.draft)
    const [offerOpen, setOfferOpen] = useState(!hasDraft)
    useEffect(() => {
        if (hasDraft) {
            setOfferOpen(false)
            return
        }
        const timer = setTimeout(() => setOfferOpen(true), 150)
        return () => clearTimeout(timer)
    }, [hasDraft])

    const createSurface = (
        // The desktop's shape: the question at the top, then the offer and the composer docked at
        // the bottom of the panel. `min-h-0` + the flex spacer is what pins them there instead of
        // letting the whole column sit under the hero.
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-4 lg:px-8">
            <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 pt-8 lg:pt-14">
                <div className="flex flex-col gap-2">
                    <h1 className="m-0 text-2xl font-semibold leading-tight lg:text-[32px]">
                        {template
                            ? FIRST_RUN_COPY.templateTitle(template.name)
                            : FIRST_RUN_COPY.title}
                    </h1>
                    {/* A template hero DESCRIBES ("Reviews PRs, comments inline…"), it does not
                        repeat the build prompt — that sits in the editor below. `description` is
                        the card's one-liner; the clamp guards a template that overruns it. */}
                    <p className="text-muted-foreground m-0 line-clamp-2 text-sm lg:text-base">
                        {template ? template.description : FIRST_RUN_COPY.subtitle}
                    </p>
                </div>

                {/* Pushes everything below to the bottom of the panel, as the desktop does. */}
                <div className="min-h-6 flex-1" />

                {/* The offer slot: the strip, until a pick answers it — the step itself docks
                    into the composer below (it belongs to the message being composed), with its
                    own ✕ in the card header to abandon it. The strip stays MOUNTED and folds
                    (the same HeightCollapse the composer's own chrome uses), so the swap with
                    the card below is one continuous motion, and its category/page survive a
                    cancelled step. */}
                {/* `slideY` gives the returning strip a small rise as it unfolds, so it reads as
                    arriving rather than popping into a hole. */}
                <HeightCollapse open={offerOpen} fade slideY={12}>
                    <FirstRunTemplates
                        onPick={pickTemplate}
                        onBrowseAll={() => void router.push(`${base}/templates`)}
                        disabled={newAgent.creating}
                    />
                </HeightCollapse>

                <FirstRunComposer
                    inputRef={inputRef}
                    attachments={attachments}
                    step={step}
                    creating={newAgent.creating}
                    setupHeader={
                        // Collapsed, not conditionally mounted: the card must still be there
                        // during the fold, or the height snaps shut the frame the step closes.
                        // `step.accounts` survives `close()` (only the draft is nulled), so the
                        // closing frames render the same rows that were on screen.
                        <HeightCollapse open={Boolean(step.draft)} fade>
                            {step.accounts.length > 0 ? (
                                <AgentSetupCard
                                    variant="docked"
                                    hideCreate
                                    accounts={step.accounts}
                                    suggestions={step.suggestions}
                                    onAddAccount={step.addAccount}
                                    // Unused (`hideCreate`) — the composer's button creates, below.
                                    onCreate={() => undefined}
                                    onReadyChange={(canCreate, selection) => {
                                        setStepReady(canCreate)
                                        selectionRef.current = selection
                                    }}
                                    onDismiss={newAgent.creating ? undefined : dismissStep}
                                    creating={newAgent.creating}
                                />
                            ) : null}
                        </HeightCollapse>
                    }
                    stepReady={stepReady}
                    // The editor holds the prompt (the template's, or the typed one), so what is
                    // in there IS what gets sent — the draft only backs it up.
                    onStepCreate={() => {
                        if (!selectionRef.current) return
                        void create(
                            inputRef.current?.getMarkdown().trim() ||
                                (step.draft?.seedMessage ?? ""),
                            selectionRef.current,
                        )
                    }}
                    onCreate={create}
                    onParkText={setRefill}
                    onTextChange={handlePromptChange}
                    // Edited a template's prompt: one tap brings the original back.
                    onResetPrompt={
                        step.draft?.template && promptEdited
                            ? () => setRefill(step.draft?.seedMessage ?? "")
                            : undefined
                    }
                />

                {/* One error line for the whole surface. A failed mint reports here too, with the
                    retry that releases its guard — never a surface that silently spins. */}
                {mintError ? (
                    <p className="text-destructive m-0 text-xs">
                        {mintError}{" "}
                        <button
                            type="button"
                            onClick={retry}
                            className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline"
                        >
                            Try again
                        </button>
                    </p>
                ) : null}
                {newAgent.error ? (
                    <p className="text-destructive m-0 text-xs">{newAgent.error}</p>
                ) : null}
            </div>
        </div>
    )

    return (
        <SessionWorkspace
            entityId={entityId}
            sessionId={sessionId}
            workspaceId={workspaceId}
            projectId={projectId}
            chat={createSurface}
            // The mounting screen renders the shell around this body; a second one stacks rails.
            bare
            // No session exists yet, so the tab strip has nothing to switch between.
            hideSessionTabs
            // Lead with the question, not the form — the configuration is one `»` away.
            collapseConfigByDefault
        />
    )
}
