import {useCallback, useState} from "react"

import {createEvaluatorFromTemplate, type EvaluatorCatalogTemplate} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"

/**
 * Turns a picked template into an unsaved local evaluator (a `local-*` workflow revision with the
 * template's config and schemas). Nothing is sent to the server until the evaluator is created.
 *
 * `onReady` receives the local revision id. The caller opens it in the evaluator editor (config,
 * test pane, create step); the editor owns it from there and discards it on close.
 */
export const useCreateEvaluatorFromTemplate = (onReady: (localRevisionId: string) => void) => {
    const [pendingKey, setPendingKey] = useState<string | null>(null)

    const start = useCallback(
        async (template: EvaluatorCatalogTemplate) => {
            setPendingKey(template.key)
            try {
                const localId = await createEvaluatorFromTemplate(template.key)
                if (!localId) {
                    message.error("Couldn't open this template. Try again.")
                    return false
                }
                onReady(localId)
                return true
            } catch (error) {
                console.error("Create evaluator from template failed", error)
                message.error("Couldn't open this template. Try again.")
                return false
            } finally {
                setPendingKey(null)
            }
        },
        [onReady],
    )

    return {start, pendingKey}
}
