import {createLogger} from "@agenta/shared/utils"
import type {LexicalEditor} from "lexical"

import type {CodeLanguage} from "../../types"
import type {CodeModelOutput} from "../model/types"

import {getValidationContext, setCurrentEditorId, subscribeValidationContext} from "./context"
import {ValidationManager, registerValidationManager, unregisterValidationManager} from "./manager"
import {EMPTY_VALIDATION_STATE, type ValidationState} from "./types"

export interface ValidationRuntimeSnapshot {
    state: ValidationState
    container: HTMLElement | null
}

export interface ValidationRuntimeOutput {
    getSnapshot: () => ValidationRuntimeSnapshot
    subscribe: (listener: () => void) => () => void
    setSnapshot: (snapshot: ValidationRuntimeSnapshot) => void
}

function isSameSnapshot(
    prevSnapshot: ValidationRuntimeSnapshot,
    nextSnapshot: ValidationRuntimeSnapshot,
): boolean {
    return (
        prevSnapshot.container === nextSnapshot.container &&
        prevSnapshot.state === nextSnapshot.state
    )
}

export function createValidationRuntimeOutput(): ValidationRuntimeOutput {
    let snapshot: ValidationRuntimeSnapshot = {
        state: EMPTY_VALIDATION_STATE,
        container: null,
    }
    const listeners = new Set<() => void>()

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        setSnapshot: (nextSnapshot) => {
            if (isSameSnapshot(snapshot, nextSnapshot)) {
                return
            }
            snapshot = nextSnapshot
            listeners.forEach((listener) => listener())
        },
    }
}

function findEditorContainer(editor: LexicalEditor): HTMLElement | null {
    const editorElement = editor.getRootElement()
    if (!editorElement) {
        return null
    }

    const possibleContainers = [
        ".agenta-editor-wrapper",
        ".editor-container",
        ".lexical-editor",
        "[data-lexical-editor]",
    ]

    for (const selector of possibleContainers) {
        const container = editorElement.closest(selector) as HTMLElement | null
        if (container) {
            return container
        }
    }

    return (editorElement.parentElement || editorElement) as HTMLElement
}

interface RegisterValidationRuntimeArgs {
    editorId: string
    modelOutput: CodeModelOutput
    output: ValidationRuntimeOutput
}

const DEFAULT_VALIDATION_DELAY_MS = 60
const LARGE_CONTENT_VALIDATION_DELAY_MS = 180
const LARGE_CONTENT_CHAR_THRESHOLD = 8000
const LARGE_CONTENT_LINE_THRESHOLD = 240
const validationRuntimeLog = createLogger("ValidationRuntime", {disabled: true})

function computeValidationDelay(content: string): number {
    let lineCount = 1
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            lineCount++
        }
    }

    if (
        content.length >= LARGE_CONTENT_CHAR_THRESHOLD ||
        lineCount >= LARGE_CONTENT_LINE_THRESHOLD
    ) {
        return LARGE_CONTENT_VALIDATION_DELAY_MS
    }

    return DEFAULT_VALIDATION_DELAY_MS
}

export function registerValidationRuntime(
    editor: LexicalEditor,
    {editorId, modelOutput, output}: RegisterValidationRuntimeArgs,
): () => void {
    validationRuntimeLog("register", {
        editorId,
        editorKey: editor.getKey(),
    })
    const editorContainer = findEditorContainer(editor)
    const editorContainerRef = {current: editorContainer}
    const validationManager = new ValidationManager(editorContainerRef)
    let schema: Record<string, unknown> | undefined = getValidationContext(editorId).schema
    let scheduledValidationTimer: ReturnType<typeof setTimeout> | null = null

    const publish = (state: ValidationState) => {
        output.setSnapshot({
            state,
            container: editorContainerRef.current,
        })
    }

    const clearScheduledValidation = () => {
        if (!scheduledValidationTimer) {
            return
        }
        clearTimeout(scheduledValidationTimer)
        scheduledValidationTimer = null
    }

    registerValidationManager(editorId, validationManager)
    setCurrentEditorId(editorId)
    publish(validationManager.getState())

    const refreshContainer = () => {
        const nextContainer = findEditorContainer(editor)
        if (editorContainerRef.current === nextContainer) {
            return
        }

        editorContainerRef.current = nextContainer
        publish(validationManager.getState())
        if (nextContainer) {
            validationManager.applyDOMStyling()
        }
    }

    const runValidation = (content: string, language: CodeLanguage) => {
        if (!schema) {
            validationRuntimeLog("runValidation: no schema", {
                editorId,
                contentLength: content.length,
                language,
            })
            clearScheduledValidation()
            publish(validationManager.clearValidationState())
            return
        }

        validationRuntimeLog("runValidation", {
            editorId,
            contentLength: content.length,
            language,
        })
        const previousState = validationManager.getState()
        setCurrentEditorId(editorId)
        const state = validationManager.validateContent(content, schema, language)
        if (state !== previousState) {
            validationManager.applyDOMStyling()
        }
        publish(state)
    }

    const runValidationFromModel = () => {
        const modelSnapshot = modelOutput.getSnapshot()
        runValidation(modelSnapshot.content, modelSnapshot.language)
    }

    const scheduleValidationFromModel = () => {
        const modelSnapshot = modelOutput.getSnapshot()
        const delay = computeValidationDelay(modelSnapshot.content)
        validationRuntimeLog("scheduleValidationFromModel", {
            editorId,
            delay,
            contentLength: modelSnapshot.content.length,
            language: modelSnapshot.language,
        })

        clearScheduledValidation()

        // Small payloads are still validated quickly; large payloads are coalesced.
        if (delay <= 0) {
            runValidationFromModel()
            return
        }

        scheduledValidationTimer = setTimeout(() => {
            scheduledValidationTimer = null
            validationRuntimeLog("runScheduledValidation", {
                editorId,
            })
            runValidationFromModel()
        }, delay)
    }

    const unregisterRootListener = editor.registerRootListener(() => {
        refreshContainer()
    })

    const unsubscribeManager = validationManager.subscribe(() => {
        publish(validationManager.getState())
    })

    const unsubscribeContext = subscribeValidationContext(editorId, (context) => {
        schema = context.schema
        runValidationFromModel()
    })

    const unsubscribeModel = modelOutput.subscribe(() => {
        validationRuntimeLog("modelOutput change", {
            editorId,
        })
        scheduleValidationFromModel()
    })

    runValidationFromModel()

    return () => {
        validationRuntimeLog("cleanup", {
            editorId,
            editorKey: editor.getKey(),
        })
        clearScheduledValidation()
        unregisterRootListener()
        unsubscribeModel()
        unsubscribeContext()
        unsubscribeManager()
        unregisterValidationManager(editorId)
    }
}
