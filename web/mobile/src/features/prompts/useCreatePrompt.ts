import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    appTemplatesQueryAtom,
    createEphemeralAppFromTemplate,
    discardLocalServerDataAtom,
    type AppType,
} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {playgroundHref} from "../playground/playgroundUrl"

import {promptsCopy} from "./promptsCopy"

/** What the create menus need to offer New prompt. */
export interface NewPromptAction {
    start: (type: AppType) => void
    /** True while the draft for a new prompt is being set up. */
    pending: boolean
}

/**
 * The New prompt flow, as in /w: a local draft app from the type's template, then a naming step
 * that creates the app (`CreatePromptDialog`), then the playground of the new app.
 *
 * The draft lives only in this browser until the create. Closing the naming step drops it.
 */
export const useCreatePrompt = ({projectBase}: {projectBase: string}) => {
    const router = useRouter()
    const discard = useSetAtom(discardLocalServerDataAtom)
    const [pending, setPending] = useState(false)
    const [draftId, setDraftId] = useState<string | null>(null)
    const inflight = useRef<AbortController | null>(null)

    const start = useCallback((type: AppType) => {
        // One draft at a time: a second click while the first is set up does nothing.
        if (inflight.current) return
        const controller = new AbortController()
        inflight.current = controller
        setPending(true)
        void createEphemeralAppFromTemplate({type, signal: controller.signal})
            .then((id) => {
                if (controller.signal.aborted) return
                if (id) setDraftId(id)
                else message.error(promptsCopy.failure.startPrompt)
            })
            .finally(() => {
                if (inflight.current !== controller) return
                inflight.current = null
                setPending(false)
            })
    }, [])

    const close = useCallback(() => {
        if (draftId) discard(draftId)
        setDraftId(null)
    }, [discard, draftId])

    const land = useCallback(
        (appId: string, revisionId: string) =>
            void router.push(playgroundHref(projectBase, appId, [revisionId])),
        [projectBase, router],
    )

    // Leaving the page stops a draft that is still being set up.
    useEffect(() => () => inflight.current?.abort(), [])

    const action = useMemo<NewPromptAction>(() => ({start, pending}), [start, pending])
    return {action, draftId, close, land}
}

/**
 * Loads the prompt templates early, so the first New prompt click does not wait for them. Mount
 * it only where New prompt is offered.
 */
export const PromptTemplatesPrefetch = () => {
    useAtomValue(appTemplatesQueryAtom)
    return null
}
