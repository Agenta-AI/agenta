import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/runnable"
import type {ExpectedType} from "@agenta/entity-ui/view-types"
import {executionItemController, playgroundController} from "@agenta/playground"
import {filterUnreferencedColumnsForSource} from "@agenta/playground/state"
import {atom, useAtomValue, useSetAtom} from "jotai"

/** One input of a test case: a variable the prompt references, with what the port schema adds. */
export interface PlaygroundInputVariable {
    /** Variable name (testcase column or template-referenced variable). */
    name: string
    /** Native value, or `undefined` when no testcase column exists yet. */
    value: unknown
    isDraft?: boolean
    /** Guidance for the variable's role, shown as a tooltip. */
    helpText?: string
    /** Declared port type. Drives the default view and the type chip while the value is empty. */
    expectedType?: ExpectedType
    /** Declared port schema. Seeds the empty shape of an object variable with no value yet. */
    expectedSchema?: unknown
}

export interface PlaygroundInputsModel {
    inputs: PlaygroundInputVariable[]
    /** Testcase columns the prompt does not reference. */
    unreferencedColumns: {name: string; value: unknown}[]
    /** Set when the row comes from a connected test set. */
    connectedSourceName: string | null
    /** Writes a native value to the test case. A new column starts on its first write. */
    setValue: (name: string, value: unknown) => void
}

/**
 * The inputs of one test case row: the visible variables with their port schema, the unused
 * columns, the connected source, and the value write. The old inputs body and the /m inputs
 * panel both read the row through this hook.
 */
export const usePlaygroundInputsModel = ({
    rowId,
    downstreamKey,
}: {
    rowId: string
    /** Namespaces the visibility computation per evaluator chain. `""` for an app alone. */
    downstreamKey: string
}): PlaygroundInputsModel => {
    const visibility = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.inputsVisibility({
                    testcaseId: rowId,
                    downstreamKey,
                }),
            [rowId, downstreamKey],
        ),
    )
    const portSchemaMap = useAtomValue(
        executionItemController.selectors.inputPortSchemaMap,
    ) as Record<string, {helpText?: string; type?: string; schema?: unknown}>

    const inputs = useMemo<PlaygroundInputVariable[]>(
        () =>
            visibility.inputs.map((v) => {
                const portSchema = portSchemaMap[v.name]
                const help = portSchema?.helpText
                const type = portSchema?.type as PlaygroundInputVariable["expectedType"]
                const schema = portSchema?.schema
                if (!help && !type && !schema) return v
                return {
                    ...v,
                    ...(help ? {helpText: help} : {}),
                    ...(type ? {expectedType: type} : {}),
                    ...(schema ? {expectedSchema: schema} : {}),
                }
            }),
        [visibility.inputs, portSchemaMap],
    )

    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null
    // The runtime always returns `{id, name, type}` or null; the cast keeps the no-loadable
    // fallback atom typeable next to the atom family's readonly atom type.
    const connectedSourceAtom = useMemo(
        () =>
            loadableId
                ? loadableController.selectors.connectedSource(loadableId)
                : (atom(() => null) as unknown as ReturnType<
                      typeof loadableController.selectors.connectedSource
                  >),
        [loadableId],
    )
    const connectedSource = useAtomValue(connectedSourceAtom) as {
        id: string | null
        name: string | null
    } | null

    const setCellValue = useSetAtom(executionItemController.actions.setTestcaseCellValue)
    const setValue = useCallback(
        (name: string, value: unknown) => setCellValue({testcaseId: rowId, column: name, value}),
        [setCellValue, rowId],
    )

    return {
        inputs,
        unreferencedColumns: filterUnreferencedColumnsForSource(
            visibility.unreferencedColumns,
            connectedSource?.id,
        ),
        connectedSourceName: connectedSource?.id ? (connectedSource.name ?? null) : null,
        setValue,
    }
}
