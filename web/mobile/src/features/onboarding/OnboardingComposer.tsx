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
        <div className="flex min-w-0 flex-col gap-2">
            <HomeTaskComposer
                mode="create"
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
                    if (!create.modelReady) {
                        chooseModelRef.current?.focus()
                        return false
                    }
                    return create.onCreate(text)
                }}
            />
            <OnboardingCreateStatus create={create} chooseModelRef={chooseModelRef} />
            <div
                role="group"
                aria-label={copy.starters}
                className="-mx-3 flex gap-1 overflow-x-auto px-3 [mask-image:linear-gradient(90deg,#000_90%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {starters.map((text) => (
                    <button
                        type="button"
                        key={text}
                        onClick={() => void inputRef.current?.setMarkdown(text)}
                        className={cn(
                            "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground min-h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-md border-0 px-2 py-[5px] text-xs leading-4",
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
