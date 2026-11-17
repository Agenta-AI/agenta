import {useCallback, useMemo, type ReactNode} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import {
    TokenPathSuggestionsProvider,
    type TokenPathSuggestion,
    type TokenPathSuggestionsGetter,
} from "@agenta/ui/editor"
import {atom, useAtomValue} from "jotai"

const SLOTS = ["inputs"] as const
/** The data of every test case on the page, all columns (the same source as /w). */
const testcaseDataAtom = atom((get) =>
    (get(executionItemController.selectors.executionRowIds) as string[]).map(
        (rowId) =>
            ((get(testcaseMolecule.data(rowId)) as {data?: Record<string, unknown>} | null)?.data ??
                {}) as Record<string, unknown>,
    ),
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const matches = (label: string, query: string) =>
    !query || label.toLowerCase().startsWith(query.toLowerCase())

const schemaKeys = (schema: unknown): string[] =>
    isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : []

/**
 * Suggestions for `{{$.inputs.…}}` in a prompt, as the old playground offers them: the prompt's
 * variables and the columns of the loaded test cases, then the keys inside an object value.
 */
export const PromptTokenPathProvider = ({
    revisionId,
    children,
}: {
    revisionId: string
    children: ReactNode
}) => {
    const ports = useAtomValue(
        useMemo(() => workflowMolecule.selectors.inputPorts(revisionId), [revisionId]),
    ) as RunnablePort[]
    const rowData = useAtomValue(testcaseDataAtom)

    const getSuggestions = useCallback<TokenPathSuggestionsGetter>(
        ([slot, ...afterSlot], query) => {
            if (slot !== "inputs") return []
            if (afterSlot.length === 0) {
                const roots = new Set<string>(ports.map((port) => port.key).filter(Boolean))
                for (const data of rowData) {
                    for (const key of Object.keys(data)) {
                        if (key !== "testcase_dedup_id") roots.add(key)
                    }
                }
                for (const reserved of KNOWN_ENVELOPE_SLOTS) roots.delete(reserved)
                return [...roots]
                    .filter((key) => matches(key, query))
                    .map((label): TokenPathSuggestion => ({label, hint: "input"}))
            }
            // One level down: the keys of an object input, from its schema or the test cases.
            if (afterSlot.length === 1) {
                const [root] = afterSlot
                const keys = new Set(schemaKeys(ports.find((port) => port.key === root)?.schema))
                for (const data of rowData) {
                    const value = data[root]
                    if (isRecord(value)) for (const key of Object.keys(value)) keys.add(key)
                }
                return [...keys]
                    .filter((key) => matches(key, query))
                    .map((label): TokenPathSuggestion => ({label, hint: "field"}))
            }
            return []
        },
        [ports, rowData],
    )

    return (
        <TokenPathSuggestionsProvider getSuggestions={getSuggestions} allowedEnvelopeSlots={SLOTS}>
            {children}
        </TokenPathSuggestionsProvider>
    )
}
