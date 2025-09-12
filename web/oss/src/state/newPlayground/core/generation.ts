import {produce} from "immer"
import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"

import type {GenerationData, TestInput, ChatMessage, ChatHistoryItem} from "../types"

/**
 * Generation Data Atoms
 *
 * These atoms manage test inputs, chat messages, and execution results.
 * Completely separate from config management for clean state separation.
 */

// Core generation data state
export const generationDataAtom = atom<GenerationData>({
    inputs: [],
    messages: [],
    metadata: {
        lastUpdated: Date.now(),
        totalRuns: 0,
    },
})

// Derived atoms for easy access
export const testInputsAtom = atom(
    (get) => get(generationDataAtom).inputs,
    (get, set, inputs: TestInput[]) => {
        set(
            generationDataAtom,
            produce((draft) => {
                draft.inputs = inputs
                draft.metadata.lastUpdated = Date.now()
            }),
        )
    },
)

export const chatMessagesAtom = atom(
    (get) => get(generationDataAtom).messages,
    (get, set, messages: ChatMessage[]) => {
        set(
            generationDataAtom,
            produce((draft) => {
                draft.messages = messages
                draft.metadata.lastUpdated = Date.now()
            }),
        )
    },
)

// Add new test input (completion mode)
export const addTestInputAtom = atom(null, (get, set, variables: Record<string, string> = {}) => {
    const newInput: TestInput = {
        __id: generateId(),
        __metadata: {
            createdAt: Date.now(),
            type: "manual",
        },
        __runs: {},
    }

    // Add variables with enhanced format
    Object.entries(variables).forEach(([key, value]) => {
        newInput[key] = {
            __id: generateId(),
            value: value || "",
            __metadata: {
                type: "string",
                title: key,
                description: `Input variable: ${key}`,
            },
        }
    })

    set(
        generationDataAtom,
        produce((draft) => {
            draft.inputs.push(newInput)
            draft.metadata.lastUpdated = Date.now()
        }),
    )

    return newInput.__id
})

// Add new chat message (chat mode)
export const addChatMessageAtom = atom(null, (get, set, variables: Record<string, string> = {}) => {
    const newMessage: ChatMessage = {
        __id: generateId(),
        __metadata: {
            createdAt: Date.now(),
            type: "manual",
        },
        __runs: {},
        history: {
            value: [],
            __metadata: {},
        },
    }

    // Add variables with enhanced format
    Object.entries(variables).forEach(([key, value]) => {
        newMessage[key] = {
            __id: generateId(),
            value: value || "",
            __metadata: {
                type: "string",
                title: key,
                description: `Input variable: ${key}`,
            },
        }
    })

    set(
        generationDataAtom,
        produce((draft) => {
            draft.messages.push(newMessage)
            draft.metadata.lastUpdated = Date.now()
        }),
    )

    return newMessage.__id
})

// Delete test input
export const deleteTestInputAtom = atom(null, (get, set, inputId: string) => {
    set(
        generationDataAtom,
        produce((draft) => {
            draft.inputs = draft.inputs.filter((input) => input.__id !== inputId)
            draft.metadata.lastUpdated = Date.now()
        }),
    )
})

// Delete chat message
export const deleteChatMessageAtom = atom(null, (get, set, messageId: string) => {
    set(
        generationDataAtom,
        produce((draft) => {
            draft.messages = draft.messages.filter((message) => message.__id !== messageId)
            draft.metadata.lastUpdated = Date.now()
        }),
    )
})

// Delete specific chat history item
export const deleteChatHistoryItemAtom = atom(
    null,
    (get, set, params: {rowId: string; messageId: string; variantId?: string}) => {
        const {rowId, messageId, variantId} = params

        set(
            generationDataAtom,
            produce((draft) => {
                const messageRow = draft.messages.find((msg) => msg.__id === rowId)
                if (!messageRow?.history?.value) return

                // Find and remove the message by ID
                const messageIndex = messageRow.history.value.findIndex(
                    (item: ChatHistoryItem) => item.__id === messageId,
                )

                if (messageIndex >= 0) {
                    messageRow.history.value.splice(messageIndex, 1)
                } else if (variantId) {
                    // Check __runs for assistant messages
                    for (const historyItem of messageRow.history.value) {
                        if (historyItem.__runs?.[variantId]) {
                            delete historyItem.__runs[variantId]
                            break
                        }
                    }
                }

                draft.metadata.lastUpdated = Date.now()
            }),
        )
    },
)

// Update test run state (loading, results, errors)
export const updateTestRunAtom = atom(
    null,
    (
        get,
        set,
        params: {
            rowId: string
            variantId: string
            isRunning?: string | boolean
            result?: any
            error?: any
        },
    ) => {
        const {rowId, variantId, isRunning, result, error} = params

        set(
            generationDataAtom,
            produce((draft) => {
                // Find the row in inputs or messages
                let targetRow =
                    draft.inputs.find((input) => input.__id === rowId) ||
                    draft.messages.find((msg) => msg.__id === rowId)

                if (!targetRow) return

                // Initialize runs if needed
                if (!targetRow.__runs) targetRow.__runs = {}
                if (!targetRow.__runs[variantId]) targetRow.__runs[variantId] = {}

                // Update run state
                if (isRunning !== undefined) {
                    targetRow.__runs[variantId].__isRunning = isRunning
                }
                if (result !== undefined) {
                    targetRow.__runs[variantId].__result = result
                    targetRow.__runs[variantId].__isRunning = undefined
                }
                if (error !== undefined) {
                    targetRow.__runs[variantId].__error = error
                    targetRow.__runs[variantId].__isRunning = undefined
                }

                targetRow.__runs[variantId].__timestamp = Date.now()
                draft.metadata.lastUpdated = Date.now()

                if (result || error) {
                    draft.metadata.totalRuns++
                }
            }),
        )
    },
)

// Clear all test results
export const clearAllResultsAtom = atom(null, (get, set) => {
    set(
        generationDataAtom,
        produce((draft) => {
            // Clear input results
            draft.inputs.forEach((input) => {
                input.__runs = {}
            })

            // Clear message results
            draft.messages.forEach((message) => {
                message.__runs = {}
                if (message.history?.value) {
                    message.history.value.forEach((item) => {
                        if (item.__runs) {
                            item.__runs = {}
                        }
                    })
                }
            })

            draft.metadata.lastUpdated = Date.now()
            draft.metadata.totalRuns = 0
        }),
    )
})
