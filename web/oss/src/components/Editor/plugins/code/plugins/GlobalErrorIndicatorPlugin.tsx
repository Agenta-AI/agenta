import React, {useEffect, useRef, useState} from "react"

import {useFloating, autoUpdate, offset, flip, shift} from "@floating-ui/react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {createPortal} from "react-dom"

import {$getActiveLanguage} from "../utils/language"
import {validateAll} from "../utils/validationUtils"

import {$getEditorCodeAsString} from "./RealTimeValidationPlugin"
import {getValidationContext, setCurrentEditorId} from "./SyntaxHighlightPlugin"

// Error info type for consistency
export interface ErrorInfo {
    id: string
    message: string
    type: "syntax" | "validation" | "schema" | "bracket" | "structural"
    line?: number
    column?: number
    severity?: "error" | "warning" | "info"
}

// Global validation state - single source of truth
interface ValidationState {
    errors: ErrorInfo[]
    errorsByLine: Map<number, ErrorInfo[]>
    lastValidatedContent: string
    timestamp: number
}

// Editor-specific validation manager - no longer singleton
class ValidationManager {
    private state: ValidationState = {
        errors: [],
        errorsByLine: new Map(),
        lastValidatedContent: "",
        timestamp: 0,
    }
    private listeners = new Set<() => void>()
    private editorContainerRef: React.RefObject<HTMLElement | null>

    constructor(editorContainerRef: React.RefObject<HTMLElement | null>) {
        this.editorContainerRef = editorContainerRef
    }

    // Run validation and update state - single source of truth
    validateContent(
        content: string,
        schema?: any,
        language: "json" | "yaml" = "json",
    ): ValidationState {
        // Skip if content hasn't changed
        if (content === this.state.lastValidatedContent) {
            return this.state
        }

        // Run unified validation using validateAll with language support
        const result = validateAll(content, schema, language)

        // Update state with new validation results
        this.state = {
            errors: result.allErrors,
            errorsByLine: result.errorsByLine,
            lastValidatedContent: content,
            timestamp: Date.now(),
        }

        // Notify all listeners of the validation state change
        this.listeners.forEach((listener) => listener())

        return this.state
    }

    // Get current validation state
    getState(): ValidationState {
        return this.state
    }

    // Subscribe to validation changes
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private notifyListeners(): void {
        this.listeners.forEach((listener) => listener())
    }

    // Get errors for a specific line - used by CodeLineNode
    getErrorsForLine(lineNumber: number): ErrorInfo[] {
        return this.state.errorsByLine.get(lineNumber) || []
    }

    // Apply validation styling to DOM elements - scoped to this editor instance
    applyDOMStyling(): void {
        const attemptStyling = (attempt = 1): void => {
            // Get editor element scoped to this specific editor instance
            const editorContainer = this.editorContainerRef.current
            if (!editorContainer) {
                return
            }

            const editorElement = editorContainer.querySelector(".editor-code") as HTMLElement
            if (!editorElement) {
                return
            }

            // Get all line elements
            const allLines = editorElement.querySelectorAll(".editor-code-line")
            // If no elements found and this is first attempt, retry after DOM is ready
            if (allLines.length === 0 && attempt === 1) {
                setTimeout(() => attemptStyling(2), 100)
                return
            }

            // CRITICAL FIX: Clear all existing validation styles first
            this.clearAllValidationStyling()

            // Apply styling to lines that need it
            this.state.errorsByLine.forEach((errors, lineNumber) => {
                if (errors.length === 0) return

                // Try multiple selectors to find the line element
                let lineElement = editorElement.querySelector(`[data-line-number="${lineNumber}"]`)
                if (!lineElement) {
                    lineElement = editorElement.querySelector(
                        `.editor-code-line:nth-child(${lineNumber})`,
                    )
                }

                if (lineElement) {
                    const htmlElement = lineElement as HTMLElement
                    const primaryError = errors[0]
                    const currentErrorMessage = htmlElement.getAttribute("data-validation-error")

                    // Only update if error message changed or element wasn't styled
                    if (currentErrorMessage !== primaryError.message) {
                        htmlElement.classList.add("validation-error")
                        htmlElement.setAttribute("data-validation-error", primaryError.message)
                        htmlElement.setAttribute(
                            "title",
                            `🔴 [${primaryError.type}] ${primaryError.message}`,
                        )
                        // Add inline styles for immediate visual feedback
                        htmlElement.style.backgroundColor = "rgba(255, 165, 0, 0.15)"
                        htmlElement.style.borderRight = "4px solid #ff8c00"
                        htmlElement.style.position = "relative"
                    }
                }
            })
        }

        attemptStyling()
    }

    // Clear all existing validation styling from DOM elements
    clearAllValidationStyling(): void {
        // Clear all validation styling from DOM - scoped to this editor only
        const editorContainer = this.editorContainerRef.current
        if (!editorContainer) return

        const allLines = editorContainer.querySelectorAll(".editor-code-line.validation-error")
        allLines.forEach((lineElement) => {
            const htmlElement = lineElement as HTMLElement
            htmlElement.classList.remove("validation-error")
            htmlElement.removeAttribute("data-validation-error")
            htmlElement.removeAttribute("title")
            // Reset inline styles
            htmlElement.style.backgroundColor = ""
            htmlElement.style.borderRight = ""
            htmlElement.style.position = ""
        })
    }

    // Force refresh of data-line-number attributes to match visual positions
    refreshLineNumberAttributes(editorElement: HTMLElement): void {
        const allLines = editorElement.querySelectorAll(".editor-code-line")

        allLines.forEach((lineElement, index) => {
            const htmlElement = lineElement as HTMLElement
            const visualLineNumber = index + 1
            const currentDataLineNumber = htmlElement.getAttribute("data-line-number")

            if (currentDataLineNumber !== visualLineNumber.toString()) {
                htmlElement.setAttribute("data-line-number", visualLineNumber.toString())
            }
        })
    }
}

// Error indicator tooltip component
function ErrorTooltip({errors}: {errors: ErrorInfo[]}) {
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
        <div className="bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 max-w-sm">
            <div className="font-semibold mb-2 text-[10px]">
                {uniqueErrors.length} Error{uniqueErrors.length !== 1 ? "s" : ""}
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
                            <div className="flex items-center justify-between">
                                <span className="text-red-300 font-medium capitalize text-[10px]">
                                    {error.type}
                                </span>
                                {lineDisplay && (
                                    <span className="text-gray-400 text-[9px]">{lineDisplay}</span>
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

// Error indicator icon component
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
                    !
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
 * This plugin provides a unified validation system that:
 * - Uses ValidationManager as single source of truth
 * - Runs validateAll once per content change
 * - Provides both global indicator and line highlighting
 * - Maintains consistency between all validation displays
 */
export function GlobalErrorIndicatorPlugin({editorId}: {editorId: string}) {
    const [editor] = useLexicalComposerContext()
    const [showTooltip, setShowTooltip] = useState(false)
    const [validationState, setValidationState] = useState<ValidationState>({
        errors: [],
        errorsByLine: new Map(),
        lastValidatedContent: "",
        timestamp: 0,
    })

    const editorContainerRef = useRef<HTMLElement | null>(null)
    const validationManager = useRef<ValidationManager | null>(null)

    // Floating UI for tooltip positioning
    const {refs, floatingStyles} = useFloating({
        middleware: [offset(10), flip(), shift()],
        whileElementsMounted: autoUpdate,
    })

    // Get validation context (schema) from global validation context
    // This is set by SyntaxHighlightPlugin when it receives the schema prop

    useEffect(() => {
        // Find editor container
        const editorElement = editor.getRootElement()

        if (editorElement) {
            // Try multiple container selectors
            const possibleContainers = [
                ".agenta-editor-wrapper",
                ".editor-container",
                ".lexical-editor",
                "[data-lexical-editor]",
            ]

            let foundContainer = null
            for (const selector of possibleContainers) {
                foundContainer = editorElement.closest(selector) as HTMLElement
                if (foundContainer) {
                    break
                }
            }

            if (!foundContainer) {
                // Fallback: use the editor element's parent or the editor element itself
                foundContainer = editorElement.parentElement || editorElement
            }

            editorContainerRef.current = foundContainer

            // Initialize validation manager now that we have the container ref
            if (!validationManager.current) {
                validationManager.current = new ValidationManager(editorContainerRef)
                // Set this editor as the current one for validation context
                setCurrentEditorId(editorId)
            }
        }

        // Run initial validation on plugin load
        const runInitialValidation = () => {
            editor.read(() => {
                const content = $getEditorCodeAsString(editor)
                const language = $getActiveLanguage(editor)

                // Get validation context for this specific editor
                const validationContext = getValidationContext(editorId)

                // Set current editor ID for validation context
                setCurrentEditorId(editorId)

                // Use ValidationManager for unified validation
                if (validationManager.current && validationContext.schema) {
                    const result = validationManager.current.validateContent(
                        content,
                        validationContext.schema,
                        language,
                    )

                    // Update validation state
                    setValidationState(result)

                    // Apply DOM styling after validation
                    validationManager.current.applyDOMStyling()
                }
            })
        }

        // Run initial validation after a longer delay to ensure editor and schema are ready
        const initialValidationTimeout = setTimeout(runInitialValidation, 500)

        // Also run validation when schema becomes available
        const schemaCheckInterval = setInterval(() => {
            const validationContext = getValidationContext()
            if (validationContext.schema && validationManager.current) {
                clearInterval(schemaCheckInterval)
                runInitialValidation()
            }
        }, 100)

        // Register editor update listener for content changes
        const unregisterUpdateListener = editor.registerUpdateListener(
            ({editorState, prevEditorState, tags}) => {
                // Skip if this update was triggered by validation or DOM updates
                if (tags.has("validation-update") || tags.has("history-merge")) {
                    return
                }

                // Skip if editor state hasn't changed
                if (editorState === prevEditorState) {
                    return
                }

                // Get current content
                const currentContent = editorState.read(() => $getEditorCodeAsString(editor))
                const language = editorState.read(() => $getActiveLanguage(editor))

                // Get validation context for this specific editor
                const validationContext = getValidationContext(editorId)

                // Run validation immediately like the original implementation
                if (validationManager.current && validationContext.schema) {
                    validationManager.current.validateContent(
                        currentContent,
                        validationContext.schema,
                        language,
                    )
                    // Apply DOM styling after validation
                    validationManager.current.applyDOMStyling()
                }
            },
        )

        // Subscribe to validation state changes if manager is available
        let unsubscribe: (() => void) | null = null
        if (validationManager.current) {
            unsubscribe = validationManager.current.subscribe(() => {
                setValidationState({...validationManager.current!.getState()})
            })
        }

        return () => {
            clearTimeout(initialValidationTimeout)
            clearInterval(schemaCheckInterval)
            unregisterUpdateListener()
            if (unsubscribe) {
                unsubscribe()
            }
        }
    }, [editor])

    const handleMouseEnter = (e: React.MouseEvent) => {
        refs.setReference(e.currentTarget as HTMLElement)
        setShowTooltip(true)
    }

    const handleMouseLeave = () => {
        setShowTooltip(false)
    }

    // Don't render if no errors or no container
    if (validationState.errors.length === 0 || !editorContainerRef.current) {
        return null
    }

    // Calculate unique errors count (group by type and message to avoid duplicates)
    const uniqueErrorsCount = Object.keys(
        validationState.errors.reduce(
            (groups, error) => {
                const key = `${error.type}:${error.message}`
                groups[key] = true
                return groups
            },
            {} as Record<string, boolean>,
        ),
    ).length

    return createPortal(
        <>
            <ErrorIndicator
                errorCount={uniqueErrorsCount}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            />
            {showTooltip && (
                <div ref={refs.setFloating} style={floatingStyles} className="z-50">
                    <ErrorTooltip errors={validationState.errors} />
                </div>
            )}
        </>,
        editorContainerRef.current,
    )
}

export {ValidationManager}
