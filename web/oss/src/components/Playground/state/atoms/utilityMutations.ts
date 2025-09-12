import {current, produce} from "immer"
import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {fetchTestset} from "@/oss/services/testsets/api"
import {
    runStatusByRowRevisionAtom,
    inputRowsByIdAtom,
    inputRowIdsAtom,
    chatTurnsByIdAtom,
    chatSessionsByIdAtom,
    chatSessionIdsAtom,
    logicalTurnIndexAtom,
    rowIdIndexAtom,
} from "@/oss/state/generation/entities"
import {appUriInfoAtom, getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

import {playgroundStateAtom} from "./core"
import {displayedVariantsVariablesAtom, displayedVariantsAtom} from "./variants"

/**
 * Utility mutations for playground operations
 * These were extracted from the original enhancedVariantMutations.ts file
 */

// Clear all runs mutation
export const clearAllRunsMutationAtom = atom(null, (get, set, variantIds?: string[] | any) => {
    // Handle case where UI passes event object instead of proper parameters
    const actualVariantIds = Array.isArray(variantIds) ? variantIds : undefined

    if (process.env.NODE_ENV === "development") {
        console.log("🧹 clearAllRunsMutationAtom:", {
            originalParam: variantIds,
            actualVariantIds,
            isEvent: variantIds && typeof variantIds === "object" && variantIds.target,
        })
    }

    // Clear test results from legacy generation data for compatibility (chat history + inputs)
    set(playgroundStateAtom, (prev) =>
        produce(prev, (draft) => {
            // Clear results from input rows
            if (draft.generationData.inputs?.value) {
                draft.generationData.inputs.value.forEach((row: any) => {
                    if (row.__runs) {
                        Object.keys(row.__runs).forEach((variantId) => {
                            if (!actualVariantIds || actualVariantIds.includes(variantId)) {
                                if (row.__runs[variantId]) {
                                    row.__runs[variantId].__result = null
                                }
                            }
                        })
                    }
                    // Also clear direct __result property
                    if (!actualVariantIds) {
                        row.__result = null
                    }
                })
            }

            // Clear results from message rows (for chat variants)
            if (draft.generationData.messages?.value) {
                draft.generationData.messages.value.forEach((row: any) => {
                    // Clear run results from message rows
                    if (row.__runs) {
                        Object.keys(row.__runs).forEach((variantId) => {
                            if (!actualVariantIds || actualVariantIds.includes(variantId)) {
                                if (row.__runs[variantId]) {
                                    row.__runs[variantId].__result = null
                                }
                            }
                        })
                    }
                    // Also clear direct __result property
                    if (!actualVariantIds) {
                        row.__result = null
                    }

                    // Clear chat message history (the actual conversation)
                    if (row.history && Array.isArray(row.history.value)) {
                        row.history.value.forEach((historyItem: any) => {
                            // Clear run results from history items
                            if (historyItem.__runs) {
                                Object.keys(historyItem.__runs).forEach((variantId) => {
                                    if (!actualVariantIds || actualVariantIds.includes(variantId)) {
                                        if (historyItem.__runs[variantId]) {
                                            historyItem.__runs[variantId].__result = null
                                            historyItem.__runs[variantId].__isRunning = false
                                        }
                                    }
                                })
                            }
                            // Clear direct result properties from history items
                            if (!actualVariantIds) {
                                historyItem.__result = null
                                historyItem.__isRunning = false
                            }
                        })

                        // For "Clear all", remove all existing messages and add empty user message
                        if (!actualVariantIds) {
                            // Use the proper method to create an empty user message
                            const allMetadata = getAllMetadata()
                            const messageMetadata = Object.values(allMetadata).find(
                                (m) =>
                                    m.title === "Message" &&
                                    "properties" in m &&
                                    "role" in m.properties,
                            )

                            const emptyUserMessage = createMessageFromSchema(messageMetadata, {
                                role: "user",
                                content: "",
                            })

                            if (emptyUserMessage) {
                                emptyUserMessage.__id = `clear-user-msg-${Date.now()}`
                                emptyUserMessage.__runs = {}
                                emptyUserMessage.__result = null
                                emptyUserMessage.__isRunning = false

                                // Clear history and add empty user message
                                row.history.value = [emptyUserMessage]
                            } else {
                                // Fallback if schema creation fails
                                row.history.value = []
                            }
                        }
                    }
                })
            }
        }),
    )

    // Normalized: clear run status for requested variants (or all)
    set(runStatusByRowRevisionAtom, (prev) => {
        const next: Record<string, {isRunning?: string | false; resultHash?: string | null}> = {}
        for (const [key, val] of Object.entries(prev || {})) {
            const parts = key.split(":")
            const revId = parts[1]
            if (!actualVariantIds || actualVariantIds.includes(revId)) {
                next[key] = {isRunning: false, resultHash: null}
            } else {
                next[key] = val
            }
        }
        return next
    })

    // Normalized: clear completion responses per revision
    set(inputRowsByIdAtom, (prev) =>
        produce(prev, (draft: any) => {
            Object.values(draft || {}).forEach((row: any) => {
                if (!row || !row.responsesByRevision) return
                if (actualVariantIds && actualVariantIds.length > 0) {
                    actualVariantIds.forEach((revId) => {
                        if (row.responsesByRevision[revId]) row.responsesByRevision[revId] = []
                    })
                } else {
                    Object.keys(row.responsesByRevision).forEach((revId) => {
                        row.responsesByRevision[revId] = []
                    })
                }
            })
        }),
    )

    // Normalized: clear chat assistant messages per revision (leave user messages intact)
    set(chatTurnsByIdAtom, (prev) =>
        produce(prev, (draft: any) => {
            Object.values(draft || {}).forEach((turn: any) => {
                if (!turn || !turn.assistantMessageByRevision) return
                if (actualVariantIds && actualVariantIds.length > 0) {
                    actualVariantIds.forEach((revId) => {
                        if (revId in (turn.assistantMessageByRevision || {})) {
                            turn.assistantMessageByRevision[revId] = null
                        }
                    })
                } else {
                    Object.keys(turn.assistantMessageByRevision).forEach((revId) => {
                        turn.assistantMessageByRevision[revId] = null
                    })
                }
            })
        }),
    )

    if (process.env.NODE_ENV === "development") {
        console.log("✅ All runs cleared")
    }
})

// Load testset data mutation
export const loadTestsetDataMutationAtom = atom(
    null,
    async (
        get,
        set,
        params: {
            testsetId?: string
            testsetData?: Record<string, any>[]
            isChatVariant?: boolean
        },
    ) => {
        const {testsetId, testsetData, isChatVariant = false} = params

        // Support both flows: direct testsetId or pre-fetched testsetData
        let testsetRows: Record<string, any>[] = []
        if (testsetData) {
            // Existing flow: use pre-fetched data
            testsetRows = testsetData
        } else if (testsetId) {
            // New flow: fetch data by ID
            const fetchedTestsetData = await fetchTestset(testsetId)
            testsetRows = fetchedTestsetData?.csvdata || []
        } else {
            return
        }

        if (testsetRows.length === 0) {
            return
        }

        // Get expected input keys from current playground state (dynamic variables from displayed variants)
        const expectedInputKeys = get(displayedVariantsVariablesAtom)
        // Fallback for custom apps: derive input keys directly from OpenAPI schema if none detected yet
        const spec = getSpecLazy()
        const routePath = get(appUriInfoAtom)?.routePath || ""
        const schemaKeys: string[] = (() => {
            try {
                return spec ? extractInputKeysFromSchema(spec as any, routePath) : []
            } catch {
                return []
            }
        })()
        const effectiveInputKeys: string[] =
            (expectedInputKeys && expectedInputKeys.length > 0 ? expectedInputKeys : schemaKeys) ||
            []

        // Process and filter testset rows based on variant type
        const filteredRows = testsetRows.map((row: Record<string, any>) => {
            const processedRow: Record<string, any> = {}

            // For chat variants, handle messages and other fields differently
            if (isChatVariant) {
                // Always preserve and parse messages field for chat variants
                if (row.messages) {
                    try {
                        // Parse messages if it's a JSON string
                        processedRow.messages =
                            typeof row.messages === "string"
                                ? JSON.parse(row.messages)
                                : row.messages
                    } catch (e) {
                        console.warn("Failed to parse messages JSON:", row.messages)
                        processedRow.messages = row.messages
                    }
                }

                // Include all other fields (parameters, variables, etc.)
                Object.entries(row).forEach(([key, value]) => {
                    if (key !== "messages") {
                        processedRow[key] = value
                    }
                })
            } else {
                // For completion variants, use the original filtering logic
                let finalInputKeys = effectiveInputKeys
                if (finalInputKeys.length === 0) {
                    // Filter out common metadata variables when no variables are configured
                    const commonMetadataKeys = new Set([
                        "correct_answer",
                        "expected_output",
                        "ground_truth",
                        "target",
                        "label",
                    ])
                    finalInputKeys = Object.keys(row).filter((key) => !commonMetadataKeys.has(key))
                }

                finalInputKeys.forEach((key) => {
                    if (row.hasOwnProperty(key)) {
                        processedRow[key] = row[key]
                    }
                })
            }

            return processedRow
        })

        // Update the playground state directly - this is where generation data lives (legacy compatibility)
        set(playgroundStateAtom, (prev) =>
            produce(prev, (draft) => {
                console.log("filteredRows", filteredRows, current(draft.generationData))
                // Initialize generation data structure if it doesn't exist
                if (!draft.generationData) {
                    draft.generationData = {
                        inputs: {value: [], __metadata: {}},
                        messages: {value: [], __metadata: {}},
                    }
                }

                if (isChatVariant) {
                    console.log("IS CHAT")
                    // For chat variants, load data into messages
                    if (!draft.generationData.messages) {
                        draft.generationData.messages = {value: [], __metadata: {}}
                    }

                    draft.generationData.messages.value = filteredRows.map((testCase, index) => {
                        console.log("testCase", testCase)
                        // Create enhanced row structure for chat mode with proper MessageRow structure
                        const enhancedRow: any = {
                            __id: `testset-message-${index}-${Date.now()}`,
                            __metadata: {},
                            __runs: {},
                        }

                        // For chat variants, extract messages from testset data
                        const historyMessages: any[] = []

                        // Check if testset has a 'messages' field (array of chat messages)
                        if (testCase.messages && Array.isArray(testCase.messages)) {
                            // Handle testset with explicit message array - use createMessageFromSchema
                            testCase.messages.forEach((msg: any, msgIndex: number) => {
                                const allMetadata = getAllMetadata()
                                const messageMetadata = Object.values(allMetadata).find(
                                    (m) =>
                                        m.title === "Message" &&
                                        "properties" in m &&
                                        "role" in m.properties,
                                )

                                const chatMessage = createMessageFromSchema(messageMetadata, msg)

                                if (chatMessage) {
                                    chatMessage.__id = `testset-msg-${index}-${msgIndex}-${Date.now()}`
                                    historyMessages.push(chatMessage)
                                }
                            })
                        } else {
                            // Handle legacy format with individual message fields
                            const messageMetadata = {
                                type: "object" as const,
                                properties: {
                                    role: {
                                        type: "string" as const,
                                    },
                                    content: {
                                        type: "string" as const,
                                    },
                                },
                            }

                            // Check for user message
                            const userMessage =
                                testCase.user_message ||
                                testCase.message ||
                                testCase.input ||
                                testCase.prompt ||
                                testCase.query
                            if (userMessage) {
                                const userMsg = createMessageFromSchema(messageMetadata, {
                                    role: "user",
                                    content: {
                                        value: userMessage,
                                    },
                                })

                                if (userMsg) {
                                    userMsg.__id = `testset-user-${index}-${Date.now()}`
                                    historyMessages.push(userMsg)
                                }
                            }

                            // If no standard message fields found, try to use the first string value
                            if (historyMessages.length === 0) {
                                const firstValue = Object.values(testCase)[0]
                                if (firstValue && typeof firstValue === "string") {
                                    const genericMsg = createMessageFromSchema(messageMetadata, {
                                        role: "user",
                                        content: {
                                            value: firstValue,
                                        },
                                    })

                                    if (genericMsg) {
                                        genericMsg.__id = `testset-generic-${index}-${Date.now()}`
                                        historyMessages.push(genericMsg)
                                    }
                                }
                            }
                        }

                        // Create the history structure
                        enhancedRow.history = {
                            __id: `testset-history-${index}-${Date.now()}`,
                            value: historyMessages,
                            __metadata: {},
                        }

                        return enhancedRow
                    })

                    // Also populate inputs with non-message testset columns for chat variants
                    if (!draft.generationData.inputs) {
                        draft.generationData.inputs = {value: [], __metadata: {}}
                    }

                    console.log("load inputs before", current(draft.generationData.inputs))

                    // Get existing variables from the current inputs to preserve configuration
                    const existingVariables = new Set<string>()
                    if (draft.generationData.inputs.value.length > 0) {
                        const firstRow = draft.generationData.inputs.value[0]
                        console.log("Existing input row structure:", firstRow)
                        Object.keys(firstRow).forEach((key) => {
                            if (!key.startsWith("__")) {
                                existingVariables.add(key)
                                console.log(`Found existing variable: ${key}`)
                            }
                        })
                    }
                    // Determine which keys to include for variables:
                    // - Prefer existing variables if any were previously configured
                    // - Else prefer expectedInputKeys derived from displayed variants
                    // - Else include all non-message fields from the testset row
                    const messageFieldKeys = new Set([
                        "messages",
                        // "message",
                        // "user_message",
                        // "system_message",
                        // "system",
                        // "input",
                        // "prompt",
                        // "query",
                    ])
                    const configVariables = new Set<string>(effectiveInputKeys || [])

                    const variableAllowlist =
                        existingVariables.size > 0
                            ? existingVariables
                            : configVariables.size > 0
                              ? configVariables
                              : new Set(
                                    Object.keys(filteredRows[0] || {}).filter(
                                        (k) => !messageFieldKeys.has(k),
                                    ),
                                )

                    console.log("filteredRows", filteredRows)
                    // Replace inputs array like completion variants but only include allowed variables
                    draft.generationData.inputs.value = filteredRows.map((testCase, index) => {
                        // Preserve original row structure if it exists, otherwise create new
                        const originalRow = draft.generationData.inputs.value[index]
                        const enhancedRow: any = {
                            __id: originalRow?.__id || `testset-input-${index}-${Date.now()}`,
                            __metadata: originalRow?.__metadata || {},
                            __runs: originalRow?.__runs || {},
                        }

                        // Only include testset properties that exist in the configuration
                        console.log(`Processing testCase for row ${index}:`, testCase)
                        Object.entries(testCase).forEach(([key, value]) => {
                            // Skip message-related fields as they're handled in messages
                            if (!messageFieldKeys.has(key) && variableAllowlist.has(key)) {
                                console.log(`✅ Adding variable ${key} with value:`, value)
                                enhancedRow[key] = {
                                    __id: `testset-${key}-${index}-${Date.now()}`,
                                    value: value,
                                    __metadata: {
                                        type: "string",
                                        title: key,
                                        description: `Testset variable: ${key}`,
                                    },
                                }
                                // Preserve original property structure if it exists
                                // const originalProperty = originalRow?.[key]
                                // enhancedRow[key] = {
                                //     __id:
                                //         originalProperty?.__id ||
                                //         `testset-${key}-${index}-${Date.now()}`,
                                //     value: value,
                                //     __metadata: originalProperty?.__metadata || {
                                //         type: "string",
                                //         title: key,
                                //         description: `Testset variable: ${key}`,
                                //     },
                                // }
                            } else {
                                console.log(
                                    `❌ Skipping ${key} - ${
                                        ![
                                            "messages",
                                            "message",
                                            "user_message",
                                            "system_message",
                                            "system",
                                            "input",
                                            "prompt",
                                            "query",
                                        ].includes(key)
                                            ? "not in existing variables"
                                            : "is message field"
                                    }`,
                                )
                            }
                        })

                        return enhancedRow
                    })
                    console.log("after updates:", current(draft.generationData))
                } else {
                    // For completion variants, load data into inputs
                    if (!draft.generationData.inputs) {
                        draft.generationData.inputs = {value: [], __metadata: {}}
                    }

                    draft.generationData.inputs.value = filteredRows.map((testCase, index) => {
                        // Create enhanced row structure for completion mode
                        const enhancedRow: any = {
                            __id: `testset-input-${index}-${Date.now()}`,
                            __metadata: {},
                            __runs: {},
                        }

                        // Convert each filtered testcase property to Enhanced format
                        Object.entries(testCase).forEach(([key, value]) => {
                            enhancedRow[key] = {
                                __id: `testset-${key}-${index}-${Date.now()}`,
                                value: value,
                                __metadata: {
                                    type: "string",
                                    title: key,
                                    description: `Testset variable: ${key}`,
                                },
                            }
                        })

                        return enhancedRow
                    })
                }
            }),
        )

        // Also seed the normalized generation store so the UI reflects loaded data
        try {
            const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
            const allVariables = (get(displayedVariantsVariablesAtom) || []) as string[]

            if (isChatVariant) {
                console.log("now this!")
                // Initialize one chat session per displayed revision
                const sessions: Record<string, any> = {}
                const sessionIds: string[] = []
                // Extract messages from the first selected row (chat modal selects single testcase)
                const testCase = filteredRows[0] || {}
                displayedRevIds.forEach((revId) => {
                    const sid = `session-${revId}`
                    sessionIds.push(sid)
                    // Determine variable ids to seed from either prompt variables or schema
                    const varIds =
                        allVariables && allVariables.length > 0 ? allVariables : effectiveInputKeys
                    sessions[sid] = {
                        id: sid,
                        variablesByRevision: {
                            [revId]: (varIds || []).map((v) => ({
                                __id: v,
                                value: (testCase as any)?.[v] ?? "",
                                content: {value: (testCase as any)?.[v] ?? ""},
                            })),
                        },
                        turnIds: [],
                        meta: {},
                    }
                })
                set(chatSessionsByIdAtom, sessions)
                set(chatSessionIdsAtom, sessionIds)

                const extractMessages = (
                    row: Record<string, any>,
                ): {role: string; content: any}[] => {
                    const result: {role: string; content: any}[] = []
                    if (Array.isArray(row?.messages)) {
                        for (const m of row.messages) {
                            const role = (m as any)?.role || (m as any)?.role?.value || "user"
                            // Preserve content shape (string or array of parts)
                            const raw = (m as any)?.content
                            const content = Array.isArray(raw)
                                ? raw
                                : raw && typeof raw === "object" && "value" in raw
                                  ? (raw as any).value
                                  : raw
                            result.push({role, content})
                        }
                        return result
                    }
                    // Legacy columns
                    if (row.system_message || row.system) {
                        result.push({role: "system", content: row.system_message || row.system})
                    }
                    if (row.user_message || row.message || row.input || row.prompt || row.query) {
                        result.push({
                            role: "user",
                            content:
                                row.user_message ||
                                row.message ||
                                row.input ||
                                row.prompt ||
                                row.query,
                        })
                    }
                    if (result.length === 0) {
                        const first = Object.values(row)[0]
                        if (typeof first === "string") {
                            result.push({role: "user", content: first})
                        }
                    }
                    return result
                }

                const msgs = extractMessages(testCase)
                const turnsToInsert: Record<string, any> = {}
                const updatedSessions: Record<string, any> = {}
                const logicalIndexUpdates: Record<string, Record<string, string>> = {}

                // Build turns: one logical turn per non-assistant message; attach assistant to the previous turn
                let pendingLogicalId: string | null = null
                let pendingTurnIdsByRev: Record<string, string> | null = null
                // Prepare a robust message factory using schema when available
                const allMd = getAllMetadata()
                const messageMd = Object.values(allMd).find(
                    (m: any) => m?.title === "Message" && m?.properties && m.properties.role,
                ) as any
                const buildEnhancedMessage = (data: {role: string; content: any}) => {
                    const m = createMessageFromSchema(messageMd, data)
                    if (m) return m

                    // Fallback minimal Enhanced shape
                    return {
                        __id: `msg-${generateId()}`,
                        role: {value: String(data?.role ?? "user"), __id: generateId()},
                        content: {
                            value:
                                typeof data?.content === "string"
                                    ? data.content
                                    : Array.isArray(data?.content)
                                      ? data.content
                                      : String(data?.content ?? ""),
                            __id: generateId(),
                        },
                    }
                }

                const ensurePendingTurn = (baseRole: string, baseContent: any) => {
                    const logicalId = `lt-${generateId()}`
                    const mapping: Record<string, string> = {}
                    displayedRevIds.forEach((revId) => {
                        const sid = `session-${revId}`
                        const tid = `turn-${revId}-${logicalId}`
                        mapping[revId] = tid
                        const baseMessage = buildEnhancedMessage({
                            role: baseRole,
                            content: baseContent,
                        })
                        turnsToInsert[tid] = {
                            id: tid,
                            sessionId: sid,
                            logicalTurnId: logicalId,
                            userMessage: baseMessage,
                            assistantMessageByRevision: {[revId]: null},
                            meta: {},
                        }
                        // IMPORTANT: Accumulate turnIds across multiple calls in this load.
                        // Use already-updated session if present, otherwise base on initial session.
                        const prevSess = updatedSessions[sid] || sessions[sid]
                        updatedSessions[sid] = {
                            ...prevSess,
                            turnIds: [...(prevSess?.turnIds || []), tid],
                        }
                    })
                    logicalIndexUpdates[logicalId] = mapping
                    pendingLogicalId = logicalId
                    pendingTurnIdsByRev = mapping
                }

                for (const m of msgs) {
                    const role = (m.role || "user").toLowerCase()
                    if (role === "assistant") {
                        // Attach assistant content to last pending turn
                        if (pendingTurnIdsByRev) {
                            displayedRevIds.forEach((revId) => {
                                const tid = pendingTurnIdsByRev![revId]
                                const node = buildEnhancedMessage({
                                    role: "assistant",
                                    content: m.content ?? "",
                                })
                                if (!turnsToInsert[tid]) {
                                    // Create minimal turn if missing
                                    const baseMessage = buildEnhancedMessage({
                                        role: "user",
                                        content: "",
                                    })
                                    turnsToInsert[tid] = {
                                        id: tid,
                                        sessionId: `session-${revId}`,
                                        logicalTurnId: pendingLogicalId,
                                        userMessage: baseMessage,
                                        assistantMessageByRevision: {},
                                        meta: {},
                                    }
                                }
                                turnsToInsert[tid].assistantMessageByRevision = {
                                    ...(turnsToInsert[tid].assistantMessageByRevision || {}),
                                    [revId]: node,
                                }
                            })
                        } else {
                            // If assistant comes first, create an empty user turn before attaching
                            ensurePendingTurn("user", "")
                            // re-run this iteration
                            displayedRevIds.forEach((revId) => {
                                const tid = pendingTurnIdsByRev![revId]
                                const node = buildEnhancedMessage({
                                    role: "assistant",
                                    content: m.content ?? "",
                                })
                                turnsToInsert[tid].assistantMessageByRevision = {
                                    ...(turnsToInsert[tid].assistantMessageByRevision || {}),
                                    [revId]: node,
                                }
                            })
                        }
                    } else {
                        // Start a new logical turn with this message as the user/system content
                        ensurePendingTurn(role, m.content)
                    }
                }

                // Commit normalized updates
                set(chatTurnsByIdAtom, (prev) => ({...prev, ...turnsToInsert}))
                set(chatSessionsByIdAtom, (prev) => ({...prev, ...updatedSessions}))

                set(logicalTurnIndexAtom, (prev) => ({...(prev || {}), ...logicalIndexUpdates}))

                // Maintain rowId index for baseline references
                set(rowIdIndexAtom, (prev) => {
                    const next = {...(prev || {})}
                    displayedRevIds.forEach((revId) => {
                        const sid = `session-${revId}`
                        const sessionTurnIds = (updatedSessions[sid]?.turnIds || []) as string[]
                        next[sid] = {
                            latestRevisionId: revId,
                            chatTurnIds: sessionTurnIds,
                        }
                    })
                    return next
                })

                // Seed a normalized input row so variable selectors can resolve values for chat
                const rowId = `row-${generateId()}`
                const variablesByRevision: Record<string, any[]> = {}
                displayedRevIds.forEach((revId) => {
                    const varIds =
                        allVariables && allVariables.length > 0 ? allVariables : effectiveInputKeys
                    variablesByRevision[revId] = (varIds || []).map((v) => ({
                        __id: generateId(),
                        key: v,
                        value: (testCase as any)?.[v] ?? "",
                        content: {value: (testCase as any)?.[v] ?? ""},
                    }))
                })
                set(inputRowsByIdAtom, (prev) => ({
                    ...(prev || {}),
                    [rowId]: {
                        id: rowId,
                        variablesByRevision,
                        responsesByRevision: {},
                        meta: {},
                    },
                }))
                set(inputRowIdsAtom, (_prev) => [rowId])
                // Link latest revision id for this row
                set(rowIdIndexAtom, (prev) => {
                    const next = {...(prev || {})}
                    const latest = displayedRevIds?.[0]
                    next[rowId] = {...(next[rowId] || {}), latestRevisionId: latest}
                    return next
                })
            } else {
                // COMPLETION MODE: seed normalized input rows from filteredRows
                const rowsById: Record<string, any> = {}
                const rowIds: string[] = []
                filteredRows.forEach((testCase, index) => {
                    const rowId = `row-${generateId()}`
                    rowIds.push(rowId)
                    const variablesByRevision: Record<string, any[]> = {}
                    displayedRevIds.forEach((revId) => {
                        variablesByRevision[revId] = (effectiveInputKeys || []).map((v) => ({
                            __id: generateId(),
                            key: v,
                            value: testCase?.[v] ?? "",
                            content: {value: testCase?.[v] ?? ""},
                        }))
                    })
                    rowsById[rowId] = {
                        id: rowId,
                        variablesByRevision,
                        responsesByRevision: {},
                        meta: {},
                    }
                })
                set(inputRowsByIdAtom, (prev) => ({...prev, ...rowsById}))
                set(inputRowIdsAtom, (_prev) => rowIds)
                // Update rowId index with latest revision id for each row
                set(rowIdIndexAtom, (prev) => {
                    const next = {...(prev || {})}
                    const latest = displayedRevIds?.[0]
                    rowIds.forEach((rid) => {
                        next[rid] = {...(next[rid] || {}), latestRevisionId: latest}
                    })
                    return next
                })
            }
        } catch (e) {
            if (process.env.NODE_ENV === "development") {
                console.error("[loadTestsetData] Failed to seed normalized store", e)
            }
        }
    },
)
