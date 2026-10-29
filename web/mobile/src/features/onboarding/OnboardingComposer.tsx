import {useRef} from "react"

import {HomeTaskComposer} from "@agenta/home-ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {OnboardingCreateStatus} from "./OnboardingCreateStatus"

const copy = ONBOARDING_COPY.creator

/** The first message, sent to create: Home's composer in create mode, saved to the draft. */
export const OnboardingComposer = ({
    message,
    onMessage,
    create,
    starters,
}: {
    message: string
    onMessage: (text: string) => void
    create: OnboardingCreateState
    starters: readonly string[]
}) => {
    const inputRef = useRef<RichChatInputHandle | null>(null)
    const chooseModelRef = useRef<HTMLButtonElement | null>(null)

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <HomeTaskComposer
                mode="create"
                ring={false}
                voice
                attachments={create.attachments}
                onStart={() => undefined}
                inputRef={inputRef}
                hideDock
                initialMarkdown={message}
                onChange={(text) => {
                    if (text !== message) onMessage(text)
                }}
                sending={create.creating}
                onCreate={({text}) => {
                    if (create.pending) return false
                    if (!create.modelReady) {
                        chooseModelRef.current?.focus()
                        return false
                    }
                    return create.onCreate(text)
                }}
            />
            <OnboardingCreateStatus create={create} chooseModelRef={chooseModelRef} />
            <div role="group" aria-label={copy.starters} className="flex flex-wrap gap-1.5">
                {starters.map((text) => (
                    <button
                        type="button"
                        key={text}
                        onClick={() => void inputRef.current?.setMarkdown(text)}
                        className={cn(
                            // White on the grey card, outlined, so they read as buttons beside the white composer.
                            "bg-background text-foreground/80 ring-border hover:text-foreground hover:ring-foreground/30 min-h-7 cursor-pointer rounded-md border-0 px-2.5 py-[5px] text-xs leading-4 ring-1 transition-shadow",
                            FOCUS_RING,
                        )}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    )
}
