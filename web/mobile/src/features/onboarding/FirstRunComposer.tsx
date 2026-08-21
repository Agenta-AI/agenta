import {useRef, useState} from "react"

import {ChatComposer} from "@agenta/chat/components"
import {stagedFilesToParts, useComposerAttachments} from "@agenta/chat/hooks"
import {markSessionFresh} from "@agenta/chat/state"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import type {useNewAgentAction} from "../agents/useNewAgentAction"

import {FIRST_RUN_COPY, FIRST_RUN_STARTERS} from "./copy"

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
}: {
    /**
     * The screen's create hook, passed in rather than called again here. A second instance would
     * keep its own `creating` flag while sharing the create core's module-wide latch, so a create
     * already in flight from the template button would make this composer swallow a submit with
     * no sign that it had.
     */
    newAgent: ReturnType<typeof useNewAgentAction>
}) => {
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const [sessionId] = useState(() => {
        const id = crypto.randomUUID()
        // Same reason as Home's composer: a session minted here has no durable records yet.
        markSessionFresh(id)
        return id
    })
    const attachments = useComposerAttachments({sessionId})

    const start = async (text: string) => {
        const staged = attachments.files
        const parts = staged.length > 0 ? stagedFilesToParts(staged, sessionId) : undefined
        // The outcome comes back as a value, not off `newAgent.error`: that flag belongs to THIS
        // render, so reading it after the await would read the state from before the create.
        const handedOff = await newAgent.createFromPrompt({text, sessionId, parts})
        // Cleared only once the destination is committed to. A create that failed leaves the files
        // staged and still sendable, and reports itself through `newAgent.error` below.
        if (handedOff) {
            attachments.clearAttachments(staged.map((file) => file.uid))
            return
        }
        // The input cleared itself on submit, so a failure would swallow the whole description.
        // Only refill an input the user has not started retyping in.
        if (!inputRef.current?.getMarkdown().trim()) inputRef.current?.setMarkdown(text)
    }

    return (
        <div className="flex flex-col gap-3">
            <ChatComposer
                inputRef={inputRef}
                onSubmit={start}
                attachments={attachments}
                placeholder={FIRST_RUN_COPY.placeholder}
                disabled={newAgent.creating}
                composerDisabled={newAgent.creating}
            />
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs">{FIRST_RUN_COPY.tryLabel}</span>
                {FIRST_RUN_STARTERS.map((starter) => (
                    <button
                        key={starter}
                        type="button"
                        disabled={newAgent.creating}
                        onClick={() => {
                            inputRef.current?.setMarkdown(starter)
                            inputRef.current?.focus()
                        }}
                        className="border-border text-muted-foreground hover:border-primary hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 box-border cursor-pointer rounded-full border border-solid bg-transparent px-3 py-1 text-xs outline-none transition-colors focus-visible:ring-[3px] disabled:opacity-50"
                    >
                        {starter}
                    </button>
                ))}
            </div>
        </div>
    )
}
