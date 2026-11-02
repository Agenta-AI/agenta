import {useEffect, useRef, useState} from "react"

import {stagedFilesToOutbound, useComposerAttachments} from "@agenta/chat/hooks"
import {markSessionFresh} from "@agenta/chat/state"
import {
    agentTemplateLookupAtomFamily,
    refetchAgentTemplatesAtom,
    templateBuilderMessage,
    UNAVAILABLE_TEMPLATE_MESSAGE,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {classifyAgentIntent} from "@agenta/shared/analytics"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {captureIntent} from "@/features/analytics/client"
import {newId} from "@/lib/ids"

import {SessionWorkspace} from "../chat/SessionWorkspace"

import {FirstRunComposer} from "./FirstRunComposer"
import {FIRST_RUN_COPY} from "./firstRunCopy"
import {FirstRunTemplates} from "./FirstRunTemplates"
import {FirstRunHeroSkeleton} from "./states/FirstRunHeroSkeleton"
import {useEphemeralAgent} from "./useEphemeralAgent"
import {useNewAgentAction} from "./useNewAgentAction"

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
 * A template pick (here, or a `?template=` arrival from any other page) creates the agent at once.
 * Accounts the template uses are connected later, when the agent asks for them.
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
    /** A pick made on another page (`?template=`): the agent is created on landing. */
    templateKey?: string
}) => {
    const newAgent = useNewAgentAction(base)
    const router = useRouter()
    const {entityId, error: mintError, retry} = useEphemeralAgent(true)
    const inputRef = useRef<RichChatInputHandle | null>(null)

    // One session id for the whole pre-commit surface: the composer stages attachments against it
    // and the workspace keys its panes off it, so they must agree before the agent exists.
    const [sessionId] = useState(() => {
        const id = newId()
        markSessionFresh(id)
        return id
    })
    const attachments = useComposerAttachments({sessionId, largeFilesToDrive: true})

    /**
     * Text parked for the editor. `ChatComposer` clears itself on submit, and a seed can arrive
     * before a render that has the editor's ref — so writes go through state and land in the
     * effect below, on the render after the editor is there to take them.
     */
    const [refill, setRefill] = useState<string | null>(null)
    useEffect(() => {
        if (refill === null) return
        inputRef.current?.setMarkdown(refill)
        inputRef.current?.focus()
        setRefill(null)
    }, [refill])

    const createFromTemplate = async (template: AgentStarterTemplate) => {
        if (!entityId) return
        const prompt = templateBuilderMessage(template)
        const handedOff = await newAgent.createFromPrompt({
            text: prompt,
            name: template.name,
            templateKey: template.key,
            sessionId,
            entityId,
        })
        // Put the prompt in the editor so Create retries this template, not a blank agent.
        if (!handedOff) setRefill(prompt)
    }

    const pickTemplate = (template: AgentStarterTemplate) => {
        captureIntent({
            source: "template",
            properties: {
                template: template.name,
                templateId: template.key,
                templateCategory: template.category,
                mode: "strip",
                surface: "onboarding",
            },
            intentValue: template.category || template.name,
        })
        void createFromTemplate(template)
    }

    // A `?template=` arrival was picked on another page, so it is created on landing — once per
    // key, because this surface stays mounted across query-only navigations.
    //
    // The catalogue is fetched, so the key resolves in three steps: pending (the hero waits), an
    // error (a retry), and only after a successful load "missing" — the existing not-found path,
    // which offers blank create as before. Never a different template, never a silent blank.
    const arrivalLookup = useAtomValue(agentTemplateLookupAtomFamily(templateKey ?? ""))
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const arrivedTemplate = templateKey ? arrivalLookup.template : undefined
    const arrivalUnresolved =
        Boolean(templateKey) &&
        (arrivalLookup.status === "pending" || arrivalLookup.status === "error")
    // Only a pending read holds create: after a failed read the error line is on screen, so a
    // create from the composer is the user's own choice of a blank agent.
    const arrivalPending = Boolean(templateKey) && arrivalLookup.status === "pending"
    const seededTemplate = useRef<string | null>(null)
    useEffect(() => {
        if (!arrivedTemplate || !entityId) return
        if (seededTemplate.current === arrivedTemplate.key) return
        seededTemplate.current = arrivedTemplate.key
        void createFromTemplate(arrivedTemplate)
    }, [arrivedTemplate, entityId])

    const create = async (text: string) => {
        // A `?template=` arrival still resolving must not turn into a blank create under it: keep
        // the typed text and wait for the template (or its retry).
        if (arrivalPending) {
            setRefill(text)
            return
        }
        if (text.trim()) {
            captureIntent({source: "composer", intentValue: classifyAgentIntent(text)})
        }
        const staged = attachments.files
        // Files over the attachment cap went to the session drive; the text names them.
        const outbound = stagedFilesToOutbound(text, staged, sessionId)
        // The outcome comes back as a value, not off `newAgent.error`: that flag belongs to THIS
        // render, so reading it after the await would read the state from before the create.
        const handedOff = await newAgent.createFromPrompt({
            text: outbound.text,
            // A `?template=` arrival whose create failed retries as that template.
            name: arrivedTemplate?.name,
            templateKey: arrivedTemplate?.key,
            sessionId,
            parts: staged.length > 0 ? outbound.parts : undefined,
            // Commit the ephemeral the config pane has been editing, not a fresh one.
            entityId: entityId ?? undefined,
        })
        // Cleared only once the destination is committed to. A create that failed leaves the files
        // staged and still sendable, and reports itself through `newAgent.error` below.
        if (handedOff) {
            attachments.clearAttachments(staged.map((file) => file.uid))
            return
        }
        // The input cleared itself on submit, so a failure would swallow the whole description.
        // Only refill an input the user has not started retyping in.
        if (!inputRef.current?.getMarkdown().trim()) setRefill(text)
    }

    // The template being created, if any — the hero speaks about it by name.
    const template = arrivedTemplate ?? null

    const createSurface = (
        // The desktop's shape: the question at the top, then the offer and the composer docked at
        // the bottom of the panel. `min-h-0` + the flex spacer is what pins them there instead of
        // letting the whole column sit under the hero.
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-4 lg:px-8">
            <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 pt-8 lg:pt-14">
                <div className="flex flex-col gap-2">
                    {/* A `?template=` arrival still loading: the hero will name it, so it holds
                        the hero's shape rather than asking the blank-create question first. */}
                    {!template && arrivalUnresolved && arrivalLookup.status === "pending" ? (
                        <FirstRunHeroSkeleton />
                    ) : (
                        <>
                            <h1 className="m-0 text-2xl font-semibold leading-tight lg:text-[32px]">
                                {template
                                    ? FIRST_RUN_COPY.templateTitle(template.name)
                                    : FIRST_RUN_COPY.title}
                            </h1>
                            {/* A template hero DESCRIBES ("Reviews PRs, comments inline…"), it
                                does not repeat the build prompt — that sits in the editor below.
                                `description` is the card's one-liner; the clamp guards a template
                                that overruns it. */}
                            <p className="text-muted-foreground m-0 line-clamp-2 text-sm lg:text-base">
                                {template ? template.description : FIRST_RUN_COPY.subtitle}
                            </p>
                        </>
                    )}
                </div>

                {/* Pushes everything below to the bottom of the panel, as the desktop does. */}
                <div className="min-h-6 flex-1" />

                {/* The offer slot: the strip folds away while a `?template=` arrival creates. */}
                <HeightCollapse open={!template} fade slideY={12}>
                    <FirstRunTemplates
                        onPick={pickTemplate}
                        onBrowseAll={() => {
                            captureIntent({source: "browse_templates"})
                            void router.push(`${base}/templates`)
                        }}
                        disabled={newAgent.creating}
                    />
                </HeightCollapse>

                <FirstRunComposer
                    inputRef={inputRef}
                    attachments={attachments}
                    creating={newAgent.creating}
                    onCreate={create}
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
                {!template && arrivalUnresolved && arrivalLookup.status === "error" ? (
                    <p className="text-destructive m-0 text-xs">
                        {FIRST_RUN_COPY.templateLoadError}{" "}
                        <button
                            type="button"
                            onClick={() => refetchTemplates()}
                            className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline"
                        >
                            Try again
                        </button>
                    </p>
                ) : null}
                {templateKey && arrivalLookup.status === "missing" ? (
                    <p className="text-muted-foreground m-0 text-xs">
                        {UNAVAILABLE_TEMPLATE_MESSAGE}
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
