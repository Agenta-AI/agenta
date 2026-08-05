export interface ValidationContext {
    editorId?: string
    schema?: Record<string, unknown>
    ajv?: unknown
    errorTexts?: Set<string>
    errorList?: unknown[]
}

type ValidationContextListener = (context: ValidationContext) => void

const EMPTY_VALIDATION_CONTEXT: ValidationContext = {}
const editorValidationContexts = new Map<string, ValidationContext>()
const validationContextListeners = new Map<string, Set<ValidationContextListener>>()

let currentEditorId: string | null = null

export function getCurrentEditorId(): string | null {
    return currentEditorId
}

export function setCurrentEditorId(editorId: string) {
    currentEditorId = editorId
}

export function getValidationContext(editorId?: string): ValidationContext {
    const targetEditorId = editorId || currentEditorId
    if (!targetEditorId) {
        return EMPTY_VALIDATION_CONTEXT
    }
    return editorValidationContexts.get(targetEditorId) || EMPTY_VALIDATION_CONTEXT
}

export function setValidationContext(editorId: string, context: ValidationContext) {
    if (!editorId) {
        return
    }

    editorValidationContexts.set(editorId, context)

    const listeners = validationContextListeners.get(editorId)
    if (!listeners || listeners.size === 0) {
        return
    }

    const nextContext = getValidationContext(editorId)
    listeners.forEach((listener) => listener(nextContext))
}

export function subscribeValidationContext(
    editorId: string,
    listener: ValidationContextListener,
): () => void {
    if (!editorId) {
        return () => {}
    }

    const listeners =
        validationContextListeners.get(editorId) || new Set<ValidationContextListener>()
    listeners.add(listener)
    validationContextListeners.set(editorId, listeners)

    listener(getValidationContext(editorId))

    return () => {
        const currentListeners = validationContextListeners.get(editorId)
        if (!currentListeners) {
            return
        }
        currentListeners.delete(listener)
        if (currentListeners.size === 0) {
            validationContextListeners.delete(editorId)
        }
    }
}
