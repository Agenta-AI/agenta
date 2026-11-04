import {useEffect, useRef} from "react"

import {Button, Spinner, Textarea} from "@agenta/ui/ui"
import {Lightbulb, PaperPlaneRight} from "@phosphor-icons/react"
import clsx from "clsx"

import type {RefineRound} from "./useRefinePrompt"

const OPTIMIZE_PROMPT = "Optimize the prompt using best practices"

const Bubble = ({text, mine, failed}: {text: string; mine?: boolean; failed?: boolean}) => (
    <p
        className={clsx(
            "m-0 max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs",
            mine
                ? "self-end bg-muted text-foreground"
                : "self-start border border-solid border-border",
            failed ? "text-destructive" : !mine && "text-foreground",
        )}
    >
        {text}
    </p>
)

export interface RefineInstructionsProps {
    rounds: RefineRound[]
    /** The instructions being refined now, or null. */
    pending: string | null
    input: string
    onInputChange: (value: string) => void
    onSend: (guidelines: string) => void
}

/**
 * The left side of the refine dialog: the rounds so far, a suggestion, and the box for new
 * instructions. Enter sends, Shift+Enter starts a new line.
 */
export const RefineInstructions = ({
    rounds,
    pending,
    input,
    onInputChange,
    onSend,
}: RefineInstructionsProps) => {
    const scrollRef = useRef<HTMLDivElement>(null)
    const busy = pending !== null

    useEffect(() => {
        scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: "smooth"})
    }, [rounds.length, pending])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                {rounds.length === 0 && !busy ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
                        <p className="m-0 text-xs">Describe how you want to refine your prompt</p>
                        <p className="m-0 text-xs">Or pick a suggestion below</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {rounds.map((round) => (
                            <div key={round.id} className="flex flex-col gap-3">
                                <Bubble text={round.guidelines} mine />
                                <Bubble text={round.reply} failed={round.failed} />
                            </div>
                        ))}
                        {busy ? (
                            <>
                                <Bubble text={pending} mine />
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Spinner size="small" />
                                    Refining prompt…
                                </div>
                            </>
                        ) : null}
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-2 border-0 border-t border-solid border-border px-3 pb-3 pt-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="self-start text-xs"
                    disabled={busy}
                    onClick={() => onSend(OPTIMIZE_PROMPT)}
                >
                    <Lightbulb size={12} aria-hidden />
                    {OPTIMIZE_PROMPT}
                </Button>
                <div className="flex items-end gap-1.5">
                    <Textarea
                        value={input}
                        onChange={(event) => onInputChange(event.target.value)}
                        onKeyDown={(event) => {
                            // The Enter that confirms an IME candidate (CJK input) must not send.
                            if (event.nativeEvent.isComposing) return
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault()
                                onSend(input)
                            }
                        }}
                        placeholder="Describe how to refine your prompt…"
                        disabled={busy}
                        rows={2}
                        className="min-h-0 flex-1 resize-none text-xs"
                    />
                    <Button
                        size="icon-sm"
                        aria-label="Send"
                        disabled={busy || !input.trim()}
                        onClick={() => onSend(input)}
                    >
                        <PaperPlaneRight size={13} aria-hidden />
                    </Button>
                </div>
            </div>
        </div>
    )
}
