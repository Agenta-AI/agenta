import {useCallback, useMemo} from "react"

import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {MessageComposer} from "@agenta/entity-ui/gatewayTrigger"
import {useAtomValue} from "jotai"

import {AutomationField} from "./AutomationField"

/**
 * What the agent is told on every run — the shared `MessageComposer`, over `data.inputs_fields`.
 *
 * Controlled by the host, with no draft of its own: both screens that mount it already hold the
 * unsaved config, and a second copy here is how a Discard leaves the old text sitting in the box.
 * Typing costs nothing now — the host holds it in memory until Save.
 *
 * The composer maps the message onto whichever input the bound agent takes; a mapping richer than
 * a single message keeps its own warning inside the composer.
 */
export const AutomationInstructionField = ({
    agentId,
    inputsFields,
    onCommit,
}: {
    agentId: string | null
    inputsFields: unknown
    onCommit: (next: Record<string, unknown>) => void
}) => {
    const inputsText = useMemo(() => JSON.stringify(inputsFields ?? {}, null, 2), [inputsFields])

    // Which input the message lands on. The stored shape wins inside the composer's own
    // getter/setter; this only decides where a message goes when there is nothing stored yet.
    const isChat = useAtomValue(workflowMolecule.selectors.executionMode(agentId ?? "")) === "chat"
    const inputSchema = useAtomValue(workflowMolecule.selectors.inputSchema(agentId ?? ""))
    const primaryKey = useMemo(() => {
        if (isChat) return "messages"
        const ports = extractInputPortsFromSchema(inputSchema)
        return ports.find((port) => port.type === "string")?.key ?? "message"
    }, [isChat, inputSchema])

    const onChange = useCallback(
        (next: string) => {
            try {
                const parsed: unknown = JSON.parse(next)
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
                onCommit(parsed as Record<string, unknown>)
            } catch {
                // The composer only ever writes valid JSON; an unparseable value is not ours.
            }
        },
        [onCommit],
    )

    return (
        <AutomationField label="Instruction">
            <MessageComposer
                inputsText={inputsText}
                onChange={onChange}
                isChat={isChat}
                primaryKey={primaryKey}
            />
        </AutomationField>
    )
}
