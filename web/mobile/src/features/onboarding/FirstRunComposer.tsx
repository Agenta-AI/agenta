import {useEffect, useRef, useState} from "react"

import {ChatComposer} from "@agenta/chat/components"
import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import type {AgentSetupSelection} from "@agenta/entities/workflow"
import type {AgentSetupStep} from "@agenta/entity-ui/onboarding"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button} from "@agenta/ui/ui"
import {ArrowRight} from "lucide-react"

import {CONNECT_STEP_MODE} from "@/lib/connectStep"

import type {useNewAgentAction} from "../agents/useNewAgentAction"

import {FIRST_RUN_COPY} from "./copy"
import {FirstRunSetupStep} from "./FirstRunSetupStep"

/**
 * The first-run composer: describe an agent, send, and it exists.
 *
 * `HomeTaskComposer` cannot serve this — it runs a task with an agent that ALREADY exists, and
 * with none to pick it disables itself. So this binds the same underlying `ChatComposer` to the
 * create path instead: the first submit runs the shared mint+commit core, stashes what was typed
 * as the session's pending task, and lands in the chat that sends it. From there the connect-model
 * gate takes over — on a keyless project the message parks and the strip asks for a key.
 *
 * The session id is minted once per mount, before the agent exists, so a file attached while
 * typing has a stable scope to upload against. Same reason [[HomeComposer]] mints its own.
 *
 * The starters are here rather than in the hero because tapping one FILLS the input instead of
 * sending it: a phone keyboard makes "describe an agent" expensive, and a half-written idea the
 * user can edit is a better opening than a blank box.
 */
export const FirstRunComposer = ({
    newAgent,
    step,
    sessionId,
    entityId,
}: {
    /**
     * The screen's create hook, passed in rather than called again here. A second instance would
     * keep its own `creating` flag while sharing the create core's module-wide latch, so a create
     * already in flight from the template button would make this composer swallow a submit with
     * no sign that it had.
     */
    newAgent: ReturnType<typeof useNewAgentAction>
    /** Owned by the screen, so the templates row can hide while the step is open. */
    step: AgentSetupStep
    /** Minted by the screen: the workspace keys its panes off the same id. */
    sessionId: string
    /** The ephemeral this surface is configuring; committed on submit. Null until it mints. */
    entityId: string | null
}) => {
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const attachments = useComposerAttachments({sessionId})
    /**
     * Text to put back once the composer is on screen again. The step REPLACES the composer, so
     * the editor is unmounted while it is open: writing to `inputRef` at the moment Edit is
     * pressed lands on a dead ref and the description is lost. Park it and refill on the render
     * that remounts the editor.
     */
    const [refill, setRefill] = useState<string | null>(null)
    useEffect(() => {
        if (step.draft || refill === null) return
        inputRef.current?.setMarkdown(refill)
        inputRef.current?.focus()
        setRefill(null)
    }, [step.draft, refill])

    const create = async (text: string, setup?: AgentSetupSelection) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        // The outcome comes back as a value, not off `newAgent.error`: that flag belongs to THIS
        // render, so reading it after the await would read the state from before the create.
        const handedOff = await newAgent.createFromPrompt({
            text,
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
        // can be retried — the description is on the card, not in the cleared input.
        if (setup) return
        // The input cleared itself on submit, so a failure would swallow the whole description.
        // Only refill an input the user has not started retyping in.
        if (!inputRef.current?.getMarkdown().trim()) inputRef.current?.setMarkdown(text)
    }

    const start = async (text: string) => {
        // Connect step on (#6043): submitting opens the step rather than creating. The accounts
        // this agent will need get connected while it is still a draft.
        if (CONNECT_STEP_MODE) {
            const typed = text.trim()
            if (!typed) return
            step.open({seedMessage: typed})
            return
        }
        await create(text)
    }

    // The step is open: what they asked for, still editable, above the card that gates create.
    if (step.draft) {
        return (
            <FirstRunSetupStep
                step={step}
                creating={newAgent.creating}
                onCreate={(selection) => void create(step.draft?.seedMessage ?? "", selection)}
                onEdit={() => {
                    setRefill(step.draft?.seedMessage ?? "")
                    step.close()
                }}
            />
        )
    }

    return (
        <ChatComposer
            inputRef={inputRef}
            onSubmit={start}
            attachments={attachments}
            placeholder={FIRST_RUN_COPY.placeholder}
            disabled={newAgent.creating}
            composerDisabled={newAgent.creating}
            // The desktop names the action instead of showing a bare send arrow: this composer
            // CREATES an agent, it does not send a message to one that exists.
            hideSendButton
            trailing={
                <Button
                    size="sm"
                    disabled={newAgent.creating}
                    onClick={() => void start(inputRef.current?.getMarkdown() ?? "")}
                >
                    {newAgent.creating ? FIRST_RUN_COPY.creating : FIRST_RUN_COPY.create}
                    <ArrowRight size={14} />
                </Button>
            }
        />
    )
}
