import {useEffect, type RefObject} from "react"

import {composerPrefillRequestAtom} from "@agenta/shared/state"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtom} from "jotai"

import {composeWithStarterPrompt} from "./composerPrefill"

/**
 * Writes the config panel's "Create with AI" starter prompt into this composer, with the caret
 * after it, ready for the user to finish the sentence.
 */
export const useComposerPrefill = (richInputRef: RefObject<RichChatInputHandle | null>) => {
    const [request, setRequest] = useAtom(composerPrefillRequestAtom)
    useEffect(() => {
        if (!request) return
        // The rich input mounts lazily and signals nothing when it is ready, so wait for its
        // handle. The request stays set until the text lands: a pick made while the
        // conversation is still loading is applied once the composer arrives, not dropped.
        let timer = 0
        const apply = () => {
            const input = richInputRef.current
            if (!input) {
                timer = window.setTimeout(apply, 100)
                return
            }
            const next = composeWithStarterPrompt(input.getMarkdown(), request.text)
            void input.setMarkdown(next).then(() => {
                // `setMarkdown` drops a trailing space, so it goes in as typed text. This also
                // focuses the input.
                input.insertText(" ")
                setRequest((current) => (current?.id === request.id ? null : current))
            })
        }
        // Deferred, so a mount that is torn down at once (React's development double mount)
        // cancels it instead of writing the prompt twice.
        timer = window.setTimeout(apply, 0)
        return () => window.clearTimeout(timer)
    }, [request, richInputRef, setRequest])
}
