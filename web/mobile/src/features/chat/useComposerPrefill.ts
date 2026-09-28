import {useEffect, type RefObject} from "react"

import {composerPrefillRequestAtom, composerPrefillTargetsAtom} from "@agenta/shared/state"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtom, useSetAtom} from "jotai"

import {composeWithStarterPrompt} from "./composerPrefill"

/**
 * Makes this composer the target of the config panel's "Create with AI": it registers itself, so
 * the panel offers the option, and writes each requested starter prompt into the input with the
 * caret after it, ready for the user to finish the sentence.
 */
export const useComposerPrefill = (richInputRef: RefObject<RichChatInputHandle | null>) => {
    const setTargets = useSetAtom(composerPrefillTargetsAtom)
    useEffect(() => {
        setTargets((count) => count + 1)
        return () => setTargets((count) => Math.max(0, count - 1))
    }, [setTargets])

    const [request, setRequest] = useAtom(composerPrefillRequestAtom)
    useEffect(() => {
        if (!request) return
        setRequest(null)
        // The rich input mounts lazily, so on a cold composer the handle can still be empty.
        // Wait for it briefly rather than drop the request.
        let attempts = 0
        let timer = 0
        const apply = () => {
            const input = richInputRef.current
            if (!input) {
                if (attempts++ < 20) timer = window.setTimeout(apply, 100)
                return
            }
            const next = composeWithStarterPrompt(input.getMarkdown(), request.text)
            // `setMarkdown` puts the caret at the end but drops a trailing space, so the space
            // goes in as typed text. `insertText` also focuses the input.
            void input.setMarkdown(next).then(() => input.insertText(" "))
        }
        apply()
        return () => window.clearTimeout(timer)
    }, [request, richInputRef, setRequest])
}
