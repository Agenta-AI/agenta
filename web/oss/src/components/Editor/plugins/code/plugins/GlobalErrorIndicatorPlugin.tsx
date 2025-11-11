import React, {useEffect, useState, useRef} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {createPortal} from "react-dom"

import {CodeHighlightNode} from "../nodes/CodeHighlightNode"
import {createLogger} from "../utils/createLogger"

import {$getEditorCodeAsString} from "./RealTimeValidationPlugin"

const PLUGIN_NAME = "GlobalErrorIndicatorPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true}) // Disabled for cleaner debugging

export interface ErrorInfo {
    id: string
    message: string
    line?: number
    column?: number
    type: "syntax" | "bracket" | "validation" | "structural" | "schema"
    severity: "error" | "warning"
}

interface GlobalErrorState {
    errors: ErrorInfo[]
    hasErrors: boolean
}

// Global error state that can be accessed by other plugins
let globalErrorState: GlobalErrorState = {
    errors: [],
    hasErrors: false,
}

// Subscribers to error state changes
const errorStateSubscribers = new Set<(state: GlobalErrorState) => void>()

/**
 * Add an error to the global error state
 */
export function addGlobalError(error: ErrorInfo) {
    const existingIndex = globalErrorState.errors.findIndex((e) => e.id === error.id)

    if (existingIndex >= 0) {
        // Update existing error
        globalErrorState.errors[existingIndex] = error
    } else {
        // Add new error
        globalErrorState.errors.push(error)
    }

    globalErrorState.hasErrors = globalErrorState.errors.length > 0

    log(`➕ Added/Updated error: ${error.id} - ${error.message}`)
    notifyErrorStateSubscribers()
}

/**
 * Remove an error from the global error state
 */
export function removeGlobalError(errorId: string) {
    const initialLength = globalErrorState.errors.length
    globalErrorState.errors = globalErrorState.errors.filter((e) => e.id !== errorId)
    globalErrorState.hasErrors = globalErrorState.errors.length > 0

    if (globalErrorState.errors.length !== initialLength) {
        log(`➖ Removed error: ${errorId}`)
        notifyErrorStateSubscribers()
    }
}

/**
 * Clear all errors from the global error state
 */
export function clearGlobalErrors() {
    if (globalErrorState.errors.length > 0) {
        globalErrorState.errors = []
        globalErrorState.hasErrors = false
        log(`🧹 Cleared all errors`)
        notifyErrorStateSubscribers()
    }
}

/**
 * Clear all errors of a specific type from the global error state
 */
export function clearGlobalErrorsByType(type: ErrorInfo["type"]) {
    const initialLength = globalErrorState.errors.length
    globalErrorState.errors = globalErrorState.errors.filter((e) => e.type !== type)
    globalErrorState.hasErrors = globalErrorState.errors.length > 0

    if (globalErrorState.errors.length !== initialLength) {
        log(`🧹 Cleared ${initialLength - globalErrorState.errors.length} errors of type: ${type}`)
        notifyErrorStateSubscribers()
    }
}

/**
 * Get current global error state
 */
export function getGlobalErrorState(): GlobalErrorState {
    return {...globalErrorState, errors: [...globalErrorState.errors]}
}

/**
 * Subscribe to global error state changes
 */
export function subscribeToErrorState(callback: (state: GlobalErrorState) => void) {
    errorStateSubscribers.add(callback)
    return () => errorStateSubscribers.delete(callback)
}

/**
 * Notify all subscribers of error state changes
 */
function notifyErrorStateSubscribers() {
    // TEMPORARILY DISABLED: Notifications were causing plugin re-instantiation
    // const state = getGlobalErrorState()
    // errorStateSubscribers.forEach((callback) => callback(state))
}

/**
 * Error indicator tooltip component
 */
function ErrorTooltip({errors, position}: {errors: ErrorInfo[]; position: {x: number; y: number}}) {
    // Group errors by message to avoid duplicates
    const groupedErrors = errors.reduce(
        (groups, error) => {
            const key = `${error.type}:${error.message}`
            if (!groups[key]) {
                groups[key] = {
                    ...error,
                    lines: [],
                }
            }
            if (error.line) {
                groups[key].lines.push(error.line)
            }
            return groups
        },
        {} as Record<string, ErrorInfo & {lines: number[]}>,
    )

    const uniqueErrors = Object.values(groupedErrors)

    return (
        <div
            className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 max-w-sm"
            style={{
                left: position.x,
                top: position.y - 10,
                transform: "translateY(-100%)",
            }}
        >
            <div className="font-semibold mb-2 text-[10px]">
                {errors.length} Error{errors.length !== 1 ? "s" : ""} Found ({uniqueErrors.length}{" "}
                unique)
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
                {uniqueErrors.map((error, index) => {
                    const sortedLines = error.lines.sort((a, b) => a - b)
                    const lineDisplay =
                        sortedLines.length > 1
                            ? `Lines ${Math.min(...sortedLines)}-${Math.max(...sortedLines)}`
                            : sortedLines.length === 1
                              ? `Line ${sortedLines[0]}`
                              : ""

                    return (
                        <div
                            key={`${error.type}-${index}`}
                            className="border-l-2 border-red-400 pl-2"
                        >
                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-[8px] px-1 py-0.25 rounded ${
                                        error.severity === "error"
                                            ? "bg-red-600 text-white"
                                            : "bg-yellow-600 text-white"
                                    }`}
                                >
                                    {error.type}
                                </span>
                                {lineDisplay && (
                                    <span className="text-gray-400 text-[8px]">{lineDisplay}</span>
                                )}
                            </div>
                            <div className="mt-1 text-gray-200 text-[10px]">{error.message}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * Error indicator icon component
 */
function ErrorIndicator({
    errorCount,
    onMouseEnter,
    onMouseLeave,
}: {
    errorCount: number
    onMouseEnter: (e: React.MouseEvent) => void
    onMouseLeave: () => void
}) {
    return (
        <div
            className="absolute top-2 right-2 z-10 cursor-pointer"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="relative">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg">
                    ⚠
                </div>
                {errorCount > 1 && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {errorCount > 9 ? "9+" : errorCount}
                    </div>
                )}
            </div>
        </div>
    )
}

/**
 * Global Error Indicator Plugin
 *
 * This plugin provides a global error indicator that:
 * - Collects errors from various sources (syntax, brackets, validation)
 * - Shows an error icon when there are errors
 * - Displays a tooltip with all errors on hover
 * - Positions itself in the top-right corner of the editor
 */
export function GlobalErrorIndicatorPlugin() {
    const [editor] = useLexicalComposerContext()
    const [showTooltip, setShowTooltip] = useState(false)
    const [tooltipPosition, setTooltipPosition] = useState({x: 0, y: 0})
    const editorContainerRef = useRef<HTMLElement | null>(null)
    const currentErrorsRef = useRef<ErrorInfo[]>([])

    // Find the editor container element
    useEffect(() => {
        const editorElement = editor.getRootElement()
        if (editorElement) {
            // Find the closest editor wrapper
            const container = editorElement.closest(".agenta-editor-wrapper") as HTMLElement
            editorContainerRef.current = container || editorElement.parentElement
        }
    }, [editor])

    // Function to collect syntax errors from CodeHighlightNodes
    const collectSyntaxErrors = (): ErrorInfo[] => {
        const syntaxErrors: ErrorInfo[] = []

        editor.read(() => {
            const root = editor.getEditorState()._nodeMap

            for (const [nodeKey, node] of root) {
                if (node instanceof CodeHighlightNode && node.hasValidationError()) {
                    const message = node.getValidationMessage()
                    if (message) {
                        // Try to find line number
                        const parent = node.getParent()
                        let lineNumber: number | undefined

                        if (parent) {
                            // Find line number by counting previous siblings
                            const grandParent = parent.getParent()
                            if (grandParent) {
                                const lines = grandParent.getChildren()
                                lineNumber = lines.indexOf(parent) + 1
                            }
                        }

                        syntaxErrors.push({
                            id: `syntax-${nodeKey}`,
                            message,
                            line: lineNumber,
                            type: "syntax",
                            severity: "error",
                        })
                    }
                }
            }
        })

        return syntaxErrors
    }

    // Function to collect all errors from editor state
    const collectAllErrors = (): ErrorInfo[] => {
        const structuralErrors = (editor as any)._structuralErrors || []
        const bracketErrors = (editor as any)._bracketErrors || []
        const schemaErrors = (editor as any)._schemaErrors || []
        const syntaxErrors = collectSyntaxErrors()

        // log(`🔍 Collecting errors:`, {
        //     structural: structuralErrors.length,
        //     bracket: bracketErrors.length,
        //     schema: schemaErrors.length,
        //     syntax: syntaxErrors.length,
        //     bracketErrorsDetail: bracketErrors,
        //     schemaErrorsDetail: schemaErrors,
        // })

        const allErrors = [...structuralErrors, ...bracketErrors, ...schemaErrors, ...syntaxErrors]
        // log(`📊 Total errors collected: ${allErrors.length}`, allErrors)

        return allErrors
    }

    // Helper function to compare error arrays for equality
    const areErrorsEqual = (errors1: ErrorInfo[], errors2: ErrorInfo[]): boolean => {
        if (errors1.length !== errors2.length) {
            return false
        }
        return errors1.every((error, index) => {
            const otherError = errors2[index]
            return (
                otherError &&
                error.id === otherError.id &&
                error.message === otherError.message &&
                error.type === otherError.type &&
                error.line === otherError.line
            )
        })
    }

    // Store validation errors in a global map to avoid separate editor updates
    const validationErrorsMapRef = useRef<Map<string, ErrorInfo | null>>(new Map())

    // Register update listener to collect errors and store them globally
    useEffect(() => {
        log("🚀 GlobalErrorIndicatorPlugin initialized")

        const unregisterUpdateListener = editor.registerUpdateListener(
            ({editorState, prevEditorState, tags}) => {
                // Skip if this update was triggered by validation error changes
                if (tags.has("validation-update")) {
                    return
                }

                // Skip if editor state hasn't changed (focus, selection, etc.)
                if (editorState === prevEditorState) {
                    return
                }

                // Additional check: Skip if this is just a focus/selection change
                // by comparing the actual text content
                let textContentChanged = false
                try {
                    const currentText = editorState.read(() => $getEditorCodeAsString(editor))
                    const prevText = prevEditorState.read(() => $getEditorCodeAsString(editor))
                    textContentChanged = currentText !== prevText
                } catch (error) {
                    // If we can't read text content, assume it changed to be safe
                    textContentChanged = true
                }

                // Only proceed if text content actually changed
                if (!textContentChanged) {
                    return
                }

                // console.log(`🔄 Text content changed - collecting validation errors`) // Disabled for cleaner debugging

                // Collect all errors from different sources
                const allErrors = collectAllErrors()

                // Check if errors have changed
                const errorsChanged = !areErrorsEqual(currentErrorsRef.current, allErrors)

                log(`🔍 Collecting errors:`, {
                    structural: allErrors.filter((e) => e.type === "structural").length,
                    bracket: allErrors.filter((e) => e.type === "bracket").length,
                    schema: allErrors.filter((e) => e.type === "schema").length,
                    syntax: allErrors.filter((e) => e.type === "syntax").length,
                    schemaErrorsDetail: allErrors.filter((e) => e.type === "schema"),
                })

                if (errorsChanged) {
                    log(`🔄 Errors changed:`, {
                        previous: currentErrorsRef.current.length,
                        current: allErrors.length,
                        errors: allErrors,
                    })

                    currentErrorsRef.current = allErrors

                    // Store syntax errors in editor state for consistency
                    const syntaxErrors = allErrors.filter((e) => e.type === "syntax")
                    ;(editor as any)._syntaxErrors = syntaxErrors

                    // Update validation errors map for use by CodeLineNode
                    const validationErrors = allErrors.filter(
                        (error) =>
                            error.type === "validation" ||
                            error.type === "schema" ||
                            error.type === "bracket" ||
                            error.type === "structural",
                    )

                    // Clear previous validation errors
                    validationErrorsMapRef.current.clear()

                    // Store new validation errors by line number
                    validationErrors.forEach((error) => {
                        if (error.line) {
                            validationErrorsMapRef.current.set(`line-${error.line}`, error)
                            log(`📍 Stored error for line ${error.line}: ${error.message}`)
                        }
                    })

                    // Store the validation errors map globally so CodeLineNode can access it
                    ;(window as any).__lexicalValidationErrorsMap = validationErrorsMapRef.current

                    // Trigger DOM updates by dispatching a custom event that CodeLineNodes can listen to
                    const event = new CustomEvent("lexical-validation-errors-changed", {
                        detail: {validationErrors},
                    })
                    window.dispatchEvent(event)

                    log(`✅ Updated validation errors map with ${validationErrors.length} errors`)
                    log(
                        `🔍 Global indicator will show ${allErrors.length} total errors:`,
                        allErrors.map((e) => `${e.type}:${e.line}:${e.message.substring(0, 30)}`),
                    )
                    log(
                        `🎨 Validation map contains ${validationErrors.length} errors for highlighting:`,
                        validationErrors.map(
                            (e) => `${e.type}:${e.line}:${e.message.substring(0, 30)}`,
                        ),
                    )
                }
            },
        )

        return () => {
            unregisterUpdateListener()
        }
    }, [editor])

    const handleMouseEnter = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setTooltipPosition({
            x: rect.left + rect.width / 2,
            y: rect.top,
        })
        setShowTooltip(true)
    }

    const handleMouseLeave = () => {
        setShowTooltip(false)
    }

    // Don't render if no errors or no container
    if (currentErrorsRef.current.length === 0 || !editorContainerRef.current) {
        return null
    }

    return createPortal(
        <>
            <ErrorIndicator
                errorCount={currentErrorsRef.current.length}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            />
            {showTooltip && (
                <ErrorTooltip errors={currentErrorsRef.current} position={tooltipPosition} />
            )}
        </>,
        editorContainerRef.current,
    )
}
