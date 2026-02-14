import {useMemo} from "react"

import {extractAllEndpointSchemas} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {atom, useAtomValue} from "jotai"

import {Testset} from "@/oss/lib/Types"

import {useInputsVsColumns} from "./useInputsVsColumns"

export interface UseTestsetInputsAnalysisParams {
    // Optional: pass routePath to fetch schema meta via atom
    routePath?: string
    // Explicit overrides to decouple from atoms when desired
    displayedVariablesOverride?: string[]
    schemaInputKeysOverride?: string[]
    requestSchemaMetaOverride?: {inputKeys?: string[]; required?: string[]}
    // The dataset to analyze
    testsetCsvData: Testset["csvdata"]
}

export interface UseTestsetInputsAnalysisResult {
    normalizedDynamicVariables: string[]
    schemaVariableCandidates: string[]
    expectedInputVariables: string[]
    shouldBlockLoad: boolean
    matchingVariableSet: Set<string>
    matchingVariables: string[]
    missingExpectedVariables: string[]
    unexpectedCsvColumns: string[]
    availableCsvColumns: string[]
    hasCompatibilityIssue: boolean
    disabledReason?: string
}

/**
 * High-level hook that can operate in two modes:
 * 1) Controlled mode: receive explicit schema/vars via overrides (no atom reads)
 * 2) Atom-backed mode: provide routePath and it will read from atoms
 */
export function useTestsetInputsAnalysis(
    params: UseTestsetInputsAnalysisParams,
): UseTestsetInputsAnalysisResult {
    const {
        routePath,
        displayedVariablesOverride,
        schemaInputKeysOverride,
        requestSchemaMetaOverride,
        testsetCsvData,
    } = params

    // Resolve dynamic variables
    const displayedVariablesFromAtoms = useAtomValue(
        playgroundController.selectors.inputVariableNames(),
    )
    const displayedVariables = displayedVariablesOverride ?? displayedVariablesFromAtoms

    // Resolve schema keys
    const schemaInputKeysFromAtoms = useAtomValue(executionItemController.selectors.schemaInputKeys)
    const schemaInputKeys = schemaInputKeysOverride ?? schemaInputKeysFromAtoms

    // Resolve schema meta from the primary entity's request payload
    const requestSchemaMetaFromAtom = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    const primaryId = get(playgroundController.selectors.primaryEntityId())
                    const meta = {
                        required: [] as string[],
                        inputKeys: [] as string[],
                        hasMessages: false,
                    }
                    if (!primaryId) return meta
                    const payload = get(runnableBridge.requestPayload(primaryId)) as any
                    if (!payload?.spec) return meta
                    const rp = payload.routePath || routePath
                    const {primaryEndpoint} = extractAllEndpointSchemas(payload.spec, rp)
                    if (!primaryEndpoint) return meta
                    const rawReqSchema = primaryEndpoint.requestSchema as any
                    meta.required = Array.isArray(rawReqSchema?.required)
                        ? rawReqSchema.required
                        : []
                    meta.inputKeys = (primaryEndpoint.requestProperties || []).filter(
                        (k: string) => !["ag_config", "messages"].includes(k),
                    )
                    meta.hasMessages = Boolean(primaryEndpoint.messagesSchema)
                    return meta
                }),
            [routePath],
        ),
    )
    const requestSchemaMeta = requestSchemaMetaOverride ?? requestSchemaMetaFromAtom

    // Normalize dynamic variables
    const normalizedDynamicVariables = useMemo(
        () =>
            (displayedVariables || [])
                .map((v) => (typeof v === "string" ? v.trim() : ""))
                .filter(Boolean),
        [displayedVariables],
    )

    // Build candidate keys from schema + dynamic vars
    const schemaVariableCandidates = useMemo(() => {
        const meta = requestSchemaMeta || {inputKeys: [], required: []}
        const primaryKeys = [...(meta.inputKeys || []), ...(meta.required || [])]
        const fallbackKeys = schemaInputKeys || []
        const result = new Map<string, string>()

        const addValue = (value: string) => {
            if (!value) return
            const normalized = value.toLowerCase()
            if (!result.has(normalized)) {
                result.set(normalized, value)
            }
        }

        const addDynamicInputs = () => {
            if (!normalizedDynamicVariables.length) return
            normalizedDynamicVariables.forEach((variable) => addValue(variable))
        }

        const handleKey = (rawKey: string) => {
            const key = typeof rawKey === "string" ? rawKey.trim() : ""
            if (!key) return
            if (key === "inputs") {
                addDynamicInputs()
                return
            }
            addValue(key)
        }

        primaryKeys.forEach(handleKey)

        if (result.size === 0) {
            fallbackKeys.forEach(handleKey)
        } else {
            fallbackKeys.forEach((key) => {
                if (!key) return
                handleKey(key)
            })
        }

        addDynamicInputs()

        return Array.from(result.values())
    }, [normalizedDynamicVariables, requestSchemaMeta, schemaInputKeys])

    const expectedInputVariables = useMemo(
        () =>
            Array.from(new Map(schemaVariableCandidates.map((v) => [v.toLowerCase(), v])).values()),
        [schemaVariableCandidates],
    )

    const {
        shouldBlockLoad,
        matchingVariableSet,
        matchingVariables,
        missingExpectedVariables,
        unexpectedCsvColumns,
        availableCsvColumns,
        hasCompatibilityIssue,
        disabledReason,
    } = useInputsVsColumns(expectedInputVariables, testsetCsvData)

    return {
        normalizedDynamicVariables,
        schemaVariableCandidates,
        expectedInputVariables,
        shouldBlockLoad,
        matchingVariables,
        matchingVariableSet,
        missingExpectedVariables,
        unexpectedCsvColumns,
        availableCsvColumns,
        hasCompatibilityIssue,
        disabledReason,
    }
}
