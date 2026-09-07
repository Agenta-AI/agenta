import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {MessageComposer} from "@agenta/entity-ui/gatewayTrigger"
import {useAtomValue} from "jotai"

import {AutomationField} from "./AutomationField"

/**
 * What the agent is told on every run — the shared `MessageComposer`, over `data.inputs_fields`.
 *
 * The draft is local and commits on blur, so a save is one round trip per edit rather than one
 * per keystroke. The composer maps the message onto whichever input the bound agent takes; a
 * mapping richer than a single message keeps its own warning inside the composer.
 */
export const AutomationInstructionField = ({
    automationId,
    agentId,
    inputsFields,
    onCommit,
}: {
    automationId: string
    agentId: string | null
    inputsFields: unknown
    onCommit: (next: Record<string, unknown>) => void
}) => {
    const stored = useMemo(() => JSON.stringify(inputsFields ?? {}, null, 2), [inputsFields])
    const [draft, setDraft] = useState(stored)

    // Rehydrate only when the automation itself changes: a refetch mid-edit must not stomp the
    // draft, and a commit's own response would otherwise reformat the field under the cursor.
    const hydratedFor = useRef(automationId)
    useEffect(() => {
        if (hydratedFor.current === automationId) return
        hydratedFor.current = automationId
        setDraft(stored)
    }, [automationId, stored])

    // Which input the message lands on. The stored shape wins inside the composer's own
    // getter/setter; this only decides where a message goes when there is nothing stored yet.
    const isChat = useAtomValue(workflowMolecule.selectors.executionMode(agentId ?? "")) === "chat"
    const inputSchema = useAtomValue(workflowMolecule.selectors.inputSchema(agentId ?? ""))
    const primaryKey = useMemo(() => {
        if (isChat) return "messages"
        const ports = extractInputPortsFromSchema(inputSchema)
        return ports.find((port) => port.type === "string")?.key ?? "message"
    }, [isChat, inputSchema])

    const commit = useCallback(() => {
        if (draft === stored) return
        try {
            const parsed: unknown = JSON.parse(draft)
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
            onCommit(parsed as Record<string, unknown>)
        } catch {
            // The composer only ever writes valid JSON; an unparseable draft is not ours to save.
        }
    }, [draft, onCommit, stored])

    return (
        <AutomationField
            label="Instruction"
        >
            {/* Blur bubbles, so the wrapper is where the composer's textarea commits from. */}
            <div onBlur={commit}>
                <MessageComposer
                    inputsText={draft}
                    onChange={setDraft}
                    isChat={isChat}
                    primaryKey={primaryKey}
                />
            </div>
        </AutomationField>
    )
}
