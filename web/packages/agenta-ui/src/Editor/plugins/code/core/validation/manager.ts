import type {CodeLanguage} from "../../types"
import {validateAll} from "../../utils/validationUtils"

import {EMPTY_VALIDATION_STATE, type ErrorInfo, ValidationState} from "./types"

interface EditorContainerRef {
    current: HTMLElement | null
}

const VALIDATION_LINE_NUMBER_ATTR = "data-validation-line-number"

function areErrorInfosEqual(a: ValidationState["errors"], b: ValidationState["errors"]): boolean {
    if (a.length !== b.length) {
        return false
    }

    for (let i = 0; i < a.length; i++) {
        const left = a[i]
        const right = b[i]
        if (
            left.id !== right.id ||
            left.line !== right.line ||
            left.column !== right.column ||
            left.type !== right.type ||
            left.message !== right.message ||
            left.severity !== right.severity
        ) {
            return false
        }
    }

    return true
}

function areErrorsByLineEqual(
    a: ValidationState["errorsByLine"],
    b: ValidationState["errorsByLine"],
): boolean {
    if (a.size !== b.size) {
        return false
    }

    for (const [lineNumber, leftErrors] of a.entries()) {
        const rightErrors = b.get(lineNumber)
        if (!rightErrors || !areErrorInfosEqual(leftErrors, rightErrors)) {
            return false
        }
    }

    return true
}

export class ValidationManager {
    private state: ValidationState = EMPTY_VALIDATION_STATE
    private listeners = new Set<() => void>()
    private editorContainerRef: EditorContainerRef
    private lastValidatedLanguage: CodeLanguage = "json"
    private lastValidatedSchema?: Record<string, unknown>

    constructor(editorContainerRef: EditorContainerRef) {
        this.editorContainerRef = editorContainerRef
    }

    validateContent(
        content: string,
        schema?: Record<string, unknown>,
        language: CodeLanguage = "json",
    ): ValidationState {
        if (
            content === this.state.lastValidatedContent &&
            language === this.lastValidatedLanguage &&
            schema === this.lastValidatedSchema
        ) {
            return this.state
        }

        const result = validateAll(content, schema, language)
        const nextState: ValidationState = {
            errors: result.allErrors,
            errorsByLine: result.errorsByLine,
            lastValidatedContent: content,
            timestamp: Date.now(),
        }
        const hasVisualChanges =
            !areErrorInfosEqual(this.state.errors, nextState.errors) ||
            !areErrorsByLineEqual(this.state.errorsByLine, nextState.errorsByLine)

        this.lastValidatedLanguage = language
        this.lastValidatedSchema = schema
        if (!hasVisualChanges) {
            // Keep the same object reference so external stores can skip redundant renders.
            this.state.lastValidatedContent = content
            this.state.timestamp = Date.now()
            return this.state
        }

        this.state = nextState
        this.notifyListeners()
        return this.state
    }

    getState(): ValidationState {
        return this.state
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getErrorsForLine(lineNumber: number) {
        return this.state.errorsByLine.get(lineNumber) || []
    }

    clearValidationState(): ValidationState {
        if (this.state.errors.length === 0 && this.state.lastValidatedContent === "") {
            return this.state
        }

        this.lastValidatedLanguage = "json"
        this.lastValidatedSchema = undefined
        this.state = {
            ...EMPTY_VALIDATION_STATE,
            errorsByLine: new Map(),
            timestamp: Date.now(),
        }

        this.clearAllValidationStyling()
        this.notifyListeners()

        return this.state
    }

    applyDOMStyling(): void {
        const attemptStyling = (attempt = 1): void => {
            const editorContainer = this.editorContainerRef.current
            if (!editorContainer) {
                return
            }

            const editorElement = editorContainer.querySelector(
                ".editor-code",
            ) as HTMLElement | null
            if (!editorElement) {
                return
            }

            const allLines = editorElement.querySelectorAll(".editor-code-line")
            if (allLines.length === 0 && attempt === 1) {
                setTimeout(() => attemptStyling(2), 100)
                return
            }

            const nextErrorByLine = new Map<number, ErrorInfo>()
            this.state.errorsByLine.forEach((errors, lineNumber) => {
                if (errors.length === 0) return
                nextErrorByLine.set(lineNumber, errors[0])
            })

            const currentlyStyledLines = editorElement.querySelectorAll<HTMLElement>(
                ".editor-code-line.validation-error",
            )
            currentlyStyledLines.forEach((lineElement) => {
                const lineNumberAttr = lineElement.getAttribute(VALIDATION_LINE_NUMBER_ATTR)
                const lineNumber = lineNumberAttr ? Number(lineNumberAttr) : NaN
                const nextError = Number.isFinite(lineNumber)
                    ? nextErrorByLine.get(lineNumber)
                    : undefined
                const currentErrorMessage = lineElement.getAttribute("data-validation-error")

                if (!nextError || currentErrorMessage !== nextError.message) {
                    this.clearLineValidationStyling(lineElement)
                }
            })

            nextErrorByLine.forEach((primaryError, lineNumber) => {
                const lineElement =
                    editorElement.querySelectorAll<HTMLElement>(`.editor-code-line`)[lineNumber - 1]

                if (!lineElement) {
                    return
                }

                const currentErrorMessage = lineElement.getAttribute("data-validation-error")
                const currentLineNumber = lineElement.getAttribute(VALIDATION_LINE_NUMBER_ATTR)
                if (
                    lineElement.classList.contains("validation-error") &&
                    currentErrorMessage === primaryError.message &&
                    currentLineNumber === String(lineNumber)
                ) {
                    return
                }

                this.applyLineValidationStyling(lineElement, lineNumber, primaryError)
            })
        }

        attemptStyling()
    }

    clearAllValidationStyling(): void {
        const editorContainer = this.editorContainerRef.current
        if (!editorContainer) {
            return
        }

        const allLines = editorContainer.querySelectorAll<HTMLElement>(
            ".editor-code-line.validation-error",
        )
        allLines.forEach((lineElement) => {
            this.clearLineValidationStyling(lineElement)
        })
    }

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

    private notifyListeners(): void {
        this.listeners.forEach((listener) => listener())
    }

    private applyLineValidationStyling(
        lineElement: HTMLElement,
        lineNumber: number,
        primaryError: ErrorInfo,
    ): void {
        lineElement.classList.add("validation-error")
        lineElement.setAttribute("data-validation-error", primaryError.message)
        lineElement.setAttribute(VALIDATION_LINE_NUMBER_ATTR, String(lineNumber))
        lineElement.setAttribute("title", `🔴 [${primaryError.type}] ${primaryError.message}`)
        lineElement.style.backgroundColor = "rgba(255, 165, 0, 0.15)"
        lineElement.style.borderRight = "4px solid #ff8c00"
        lineElement.style.position = "relative"
    }

    private clearLineValidationStyling(lineElement: HTMLElement): void {
        lineElement.classList.remove("validation-error")
        lineElement.removeAttribute("data-validation-error")
        lineElement.removeAttribute(VALIDATION_LINE_NUMBER_ATTR)
        lineElement.removeAttribute("title")
        lineElement.style.backgroundColor = ""
        lineElement.style.borderRight = ""
        lineElement.style.position = ""
    }
}

const validationManagerRegistry = new Map<string, ValidationManager>()

export function registerValidationManager(editorId: string, manager: ValidationManager) {
    if (!editorId) return
    validationManagerRegistry.set(editorId, manager)
}

export function getValidationManager(editorId: string): ValidationManager | null {
    return validationManagerRegistry.get(editorId) ?? null
}

export function unregisterValidationManager(editorId: string) {
    if (!editorId) return
    validationManagerRegistry.delete(editorId)
}
