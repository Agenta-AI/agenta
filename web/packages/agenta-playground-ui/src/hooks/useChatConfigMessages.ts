import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {extractPromptTemplateContext, normalizeEnhancedMessages} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * The prompt's own messages of a chat revision, read only: every object in `ag_config` (or the
 * config itself) that has `messages` or `llm_config` adds its messages, in config order. Also
 * returns the template format and tokens of those prompts.
 */
export function useChatConfigMessages(entityId: string) {
    const configuration = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId || ""), [entityId]),
    )

    const promptConfigs = useMemo(() => {
        const params = isRecord(configuration) ? configuration : {}
        const agConfig = isRecord(params.ag_config) ? params.ag_config : params
        return Object.values(agConfig).filter(
            (value): value is Record<string, unknown> =>
                isRecord(value) && Boolean(value.messages || value.llm_config),
        )
    }, [configuration])

    const messages = useMemo(
        () =>
            normalizeEnhancedMessages(
                promptConfigs.flatMap((cfg) => (Array.isArray(cfg.messages) ? cfg.messages : [])),
            ),
        [promptConfigs],
    )
    const {templateFormat, tokens} = useMemo(
        () => extractPromptTemplateContext(promptConfigs),
        [promptConfigs],
    )

    return {messages, templateFormat, tokens}
}
