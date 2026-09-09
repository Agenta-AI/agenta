import {useRef, type ReactNode, type RefObject} from "react"

import {
    ChatComposer,
    MicPermissionNotice,
    RecordingBar,
    VoiceInputButton,
} from "@agenta/chat/components"
import {useVoiceComposer, type useComposerAttachments} from "@agenta/chat/hooks"
import {AgentChip} from "@agenta/entity-ui/agent"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button} from "@agenta/ui/ui"
import {RobotIcon, XIcon} from "@phosphor-icons/react"

export interface HomeTaskComposerAgent {
    id: string
    name: string
}

/** What the composer is for right now: running a task, or describing an agent to create. */
export type HomeComposerMode = "task" | "create"

/** What a bound template contributes to the dock. Structural, so hosts need not pass the whole
 * catalogue entry. */
export interface HomeComposerTemplate {
    name: string
    initials: string
    color: string
}

export interface HomeTaskComposerProps {
    /** Agents the dock can name. Ordering is the host's — see `agentId` for what is bound. */
    agents: HomeTaskComposerAgent[]
    /** The attachment engine (staging + uploads); the host owns its rollout flag and scope. */
    attachments: ReturnType<typeof useComposerAttachments>
    /** Start the task. Called only with a resolved agent. */
    onStart: (input: {agentId: string; text: string}) => void | Promise<void>
    /**
     * Pin the composer to one agent and drop the dock — an agent's own page already answers
     * "which agent", so naming it again under the input says nothing.
     */
    fixedAgentId?: string
    /** Placeholder override; a pinned host names the agent it is talking to. */
    placeholder?: string
    /** How far the editor may grow. A surface with a page under it wants a lower ceiling. */
    maxHeightClassName?: string
    /**
     * The bound agent, already resolved. The HOST owns the selection — it is what the list marks
     * too, so resolving it in both places is how the two stop agreeing.
     */
    agentId?: string | null
    /**
     * `create` turns the same composer into "describe an agent": the dock names what is about to
     * be built and send creates instead of starting. A separate create composer beside this one
     * would be two inputs answering the same question in the same place.
     */
    mode?: HomeComposerMode
    /** Send, in create mode. Absent ⇒ the host does not offer creating here. */
    onCreate?: (input: {text: string}) => void | Promise<void>
    /** Unbind. The host's answer is create mode — the composer is never aimed at nothing. */
    onClear?: () => void
    /** A template the composer is building from — named in the dock like an agent is. */
    template?: HomeComposerTemplate | null
    /** The input itself, for a host that needs to put the caret in it (switching to create). */
    inputRef?: RefObject<RichChatInputHandle | null>
    /**
     * Offer dictation and voice messages. OFF by default: this composer is shared, and a mic on a
     * surface that never asked for one is a control its host cannot explain.
     */
    voice?: boolean
}

const CREATE_PLACEHOLDER = "Describe the agent you want — what it does, when it runs…"

/** What the composer is aimed at, named under the input. One shape for an agent and a template —
 * only the tile differs, and two copies of this row is how they stop matching. */
const DockLabel = ({
    tile,
    name,
    onClear,
    clearLabel,
}: {
    tile: ReactNode
    name: string
    onClear?: () => void
    clearLabel?: string
}) => (
    <>
        <span className="flex min-w-0 items-center gap-1.5 pl-1 text-[12px] text-foreground">
            {tile}
            <span className="min-w-0 truncate">{name}</span>
        </span>
        {onClear ? (
            <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-5"
                aria-label={clearLabel}
                onClick={onClear}
            >
                <XIcon size={13} />
            </Button>
        ) : null}
    </>
)

/**
 * Home's primary action: describe a task, aim it at an agent, send.
 *
 * Which agent it is aimed at is NAMED in a dock under the input, not picked there: the list below
 * the composer is what binds one, and a dropdown here was a second way to do the same thing that
 * also hid the fact that the rows do it. The send button stays where it always is — that
 * affordance is the one the rest of the app teaches.
 *
 * Two modes, one input. `task` runs work with an agent that exists; `create` describes one to
 * make. Create used to live inside a picker as a hidden option, which meant send did two different
 * things depending on a selection you could not see — here the mode is visible in the dock.
 *
 * NOTE: the create-mode ring animates through `animate-composer-ring`/`animate-composer-ring-in`,
 * whose keyframes are the HOST's (this package ships no CSS and has no motion dependency). A host
 * without them renders a still ring, silently.
 */
export const HomeTaskComposer = ({
    agents,
    attachments,
    onStart,
    fixedAgentId,
    placeholder = "Describe the task, or start the conversation…",
    maxHeightClassName,
    agentId,
    mode = "task",
    onCreate,
    onClear,
    template,
    inputRef,
    voice: voiceEnabled = false,
}: HomeTaskComposerProps) => {
    const effectiveAgentId = fixedAgentId ?? agentId ?? null
    const creating = mode === "create"

    // Voice needs a handle whether or not the host asked for one.
    const ownInputRef = useRef<RichChatInputHandle | null>(null)
    const richInputRef = inputRef ?? ownInputRef

    // A take here is always an ATTACHMENT, never a message of its own: there is no conversation to
    // send it into — the composer's text is what gets sent, with the clip riding along.
    const voice = useVoiceComposer({
        richInputRef,
        stagedCount: attachments.files.length,
        onAttach: (file) => attachments.addFiles([file]),
        onSendVoiceMessage: (file) => attachments.addFiles([file]),
    })

    const selectedName = agents.find((agent) => agent.id === effectiveAgentId)?.name

    // A blank create cannot be cleared: the composer always sends somewhere, and "aimed at
    // nothing" is not a state it can be in. Binding one of the rows below is what replaces it. A
    // template IS clearable, because clearing it lands back on that blank create.
    const dock = template ? (
        <DockLabel
            tile={
                <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-control-sm text-[10px] font-medium text-white"
                    style={{background: template.color}}
                >
                    {template.initials}
                </span>
            }
            name={template.name}
            onClear={onClear}
            clearLabel="Clear this template"
        />
    ) : creating ? (
        <DockLabel
            tile={
                <span className="flex size-5 shrink-0 items-center justify-center rounded-control-sm bg-colorFillSecondary text-muted-foreground">
                    <RobotIcon aria-hidden size={13} />
                </span>
            }
            name="New agent"
        />
    ) : fixedAgentId || !effectiveAgentId ? null : (
        <DockLabel
            tile={<AgentChip workflowId={effectiveAgentId} box="size-5" glyph={13} />}
            name={selectedName ?? "Agent"}
            onClear={onClear}
            clearLabel="Unbind this agent"
        />
    )

    return (
        <div className="relative flex flex-col">
            {voiceEnabled ? (
                <MicPermissionNotice
                    open={!!voice.micError && !voice.voiceRecorder.active}
                    message={voice.micError}
                    onDismiss={voice.dismissMicError}
                />
            ) : null}
            {/* Lifted, so the dock behind it stays behind it. The ring lives HERE and not around
                the whole thing: it marks the box you are typing in, and sweeping the dock too made
                it read as a border on the pair. */}
            <div className="relative z-10 box-border rounded-[9px] p-px">
                {creating ? (
                    // A conic sweep behind the composer's own border, clipped to its radius.
                    <div className="animate-composer-ring-in pointer-events-none absolute inset-0 overflow-hidden rounded-[9px]">
                        <div
                            className="animate-composer-ring absolute left-1/2 top-1/2 w-[170%] pb-[170%]"
                            style={{
                                background:
                                    "conic-gradient(from 0deg, transparent 0 58%, color-mix(in oklab, var(--ag-colorText) 50%, transparent) 80%, transparent 100%)",
                            }}
                        />
                    </div>
                ) : null}
                {/* Opaque, so the sweep behind it shows only as the 1px rim the padding leaves —
                    a composer you can read the animation through is a distraction, not a border. */}
                <div
                    className={
                        creating
                            ? "relative flex flex-col overflow-hidden rounded-lg bg-[var(--ag-colorBgContainer)]"
                            : "relative flex flex-col"
                    }
                >
                    <ChatComposer
                        inputRef={richInputRef}
                        dictating={voiceEnabled && voice.dictating}
                        dictationAnalyserRef={voiceEnabled ? voice.dictationAnalyserRef : undefined}
                        onSubmit={async (text) => {
                            if (creating) {
                                await onCreate?.({text})
                                return
                            }
                            if (!effectiveAgentId) return
                            await onStart({agentId: effectiveAgentId, text})
                        }}
                        attachments={attachments}
                        placeholder={creating ? CREATE_PLACEHOLDER : placeholder}
                        disabled={!creating && !effectiveAgentId}
                        maxHeightClassName={maxHeightClassName}
                        extraPrefix={
                            voiceEnabled ? (
                                <VoiceInputButton
                                    inputRef={richInputRef}
                                    onStartAudio={voice.startVoiceMessage}
                                    audioSupported={voice.voiceRecorder.supported}
                                    audioPending={voice.voiceRecorder.pending}
                                    // This surface reads no model catalogue, so it makes no claim
                                    // about whether the agent can hear — the menu stays neutral.
                                    audioPerceivable={null}
                                    attachmentsFull={attachments.atMax}
                                    onDictationError={voice.setDictationError}
                                    onDictatingChange={voice.setDictating}
                                    stopRef={voice.dictationStopRef}
                                />
                            ) : null
                        }
                        // While the ring is running it IS the border. The composer's own edge —
                        // and the focus edge the autofocus fires — paint over the ring's 1px rim
                        // and hide the very thing the mode exists to show. `!`, because
                        // RichChatInput composes with clsx, so a plain class would be left to
                        // stylesheet order against its own `focus-within:border-*`.
                        className={creating ? "!border-transparent" : undefined}
                    />
                </div>
                {voiceEnabled && voice.voiceRecorder.takeoverVisible ? (
                    <div className="pointer-events-none absolute inset-0 flex justify-center">
                        <RecordingBar
                            recorder={voice.voiceRecorder}
                            willSend={voice.voiceWillSend}
                            className="h-full w-full"
                        />
                    </div>
                ) : null}
            </div>
            {/* Docked UNDER the composer, not inside its footer: what the message is aimed at is a
                standing fact about the composer, and in the footer it competed for the same row as
                the actions you take on this one message.
                
                It slides BEHIND the composer — transparent, the divider step for a border, inset
                1px to match the ring wrapper's own padding — so the composer keeps its shape and
                only the dock's sides and foot show. No top border: the composer's fill is 4%
                opaque, so a line tucked under it shows straight THROUGH rather than behind, and
                its own bottom edge is the rule between them. */}
            {dock ? (
                <div className="-mt-6 mx-px flex items-center gap-2 rounded-b-lg border border-t-0 border-solid border-[var(--ag-colorSplit)] bg-transparent px-2.5 pb-2 pt-8">
                    {dock}
                </div>
            ) : null}
        </div>
    )
}
