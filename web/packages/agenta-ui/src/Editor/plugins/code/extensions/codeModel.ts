import {createLogger} from "@agenta/shared/utils"
import {defineExtension} from "lexical"

import {ENTER_KEY_UPDATE_TAG, HIGHLIGHT_ONLY_UPDATE_TAG} from "../core/highlight/updateTags"
import {createCodeModelOutput} from "../core/model/store"
import {setCurrentEditorId, setValidationContext} from "../core/validation/context"
import {$getEditorCodeAsString} from "../plugins/RealTimeValidationPlugin"
import type {CodeLanguage} from "../types"
import {$getActiveLanguage} from "../utils/language"

const DEFAULT_MODEL_PUBLISH_DELAY_MS = 40
const LARGE_DOC_MODEL_PUBLISH_DELAY_MS = 140
const ENTER_KEY_MODEL_PUBLISH_DELAY_MS = 500
const LARGE_DOC_CHAR_THRESHOLD = 8000
const LARGE_DOC_LINE_THRESHOLD = 240
const log = createLogger("CodeModelExtension", {disabled: true})
const DEBUG_SKIP_UPDATE_LOGS = false
const DEBUG_MODEL_TIMING_LOGS = true

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

export const CodeModelExtension = defineExtension({
    name: "@agenta/editor/code/CodeModel",
    config: {
        editorId: "",
        schema: undefined as Record<string, unknown> | undefined,
    },
    build: (_editor, config) => {
        log("build", {
            editorId: config.editorId,
        })
        return createCodeModelOutput({
            editorId: config.editorId,
            content: "",
            language: "json",
            timestamp: Date.now(),
        })
    },
    register: (editor, config, state) => {
        log("register", {
            editorId: config.editorId,
            editorKey: editor.getKey(),
            hasSchema: Boolean(config.schema),
        })
        const output = state.getOutput()
        let modelPublishTimer: ReturnType<typeof setTimeout> | null = null
        let pendingPublishReason: "regular" | "enter" = "regular"

        const $publishSnapshot = () => {
            const serializeStartMs = getNow()
            const content = $getEditorCodeAsString(editor)
            const serializeMs = getNow() - serializeStartMs
            const language = $getActiveLanguage(editor) as CodeLanguage
            log("publishSnapshot", {
                editorId: config.editorId,
                contentLength: content.length,
                language,
            })

            // Cache line count for getPublishDelay — avoids a separate
            // editor.getEditorState().read() call on every update.
            let lineCount = 1
            for (let i = 0; i < content.length; i++) {
                if (content.charCodeAt(i) === 10) lineCount++
            }
            cachedLineCount = lineCount

            output.setSnapshot({
                editorId: config.editorId,
                content,
                language,
                timestamp: Date.now(),
            })

            return {
                contentLength: content.length,
                language,
                serializeMs,
            }
        }

        let cachedLineCount = 0

        const getPublishDelay = (reason: "regular" | "enter") => {
            if (reason === "enter") {
                return ENTER_KEY_MODEL_PUBLISH_DELAY_MS
            }
            const snapshot = output.getSnapshot()
            if (snapshot.content.length >= LARGE_DOC_CHAR_THRESHOLD) {
                return LARGE_DOC_MODEL_PUBLISH_DELAY_MS
            }
            if (cachedLineCount >= LARGE_DOC_LINE_THRESHOLD) {
                return LARGE_DOC_MODEL_PUBLISH_DELAY_MS
            }
            return DEFAULT_MODEL_PUBLISH_DELAY_MS
        }

        const clearScheduledPublish = () => {
            if (!modelPublishTimer) {
                return
            }
            clearTimeout(modelPublishTimer)
            modelPublishTimer = null
        }

        const schedulePublish = (reason: "regular" | "enter") => {
            const delay = getPublishDelay(reason)
            pendingPublishReason = reason
            log("schedulePublish", {
                editorId: config.editorId,
                delay,
                reason,
            })
            clearScheduledPublish()
            modelPublishTimer = setTimeout(() => {
                modelPublishTimer = null
                const callbackStartMs = getNow()
                editor.getEditorState().read(() => {
                    setCurrentEditorId(config.editorId)
                    const snapshotTiming = $publishSnapshot()
                    if (DEBUG_MODEL_TIMING_LOGS) {
                        log("publishSnapshotTiming", {
                            editorId: config.editorId,
                            reason: pendingPublishReason,
                            contentLength: snapshotTiming.contentLength,
                            language: snapshotTiming.language,
                            serializeMs: Number(snapshotTiming.serializeMs.toFixed(2)),
                            callbackMs: Number((getNow() - callbackStartMs).toFixed(2)),
                        })
                    }
                })
            }, delay)
        }

        setCurrentEditorId(config.editorId)
        setValidationContext(config.editorId, {
            schema: config.schema,
            errorTexts: new Set(),
            errorList: [],
        })

        editor.getEditorState().read(() => {
            $publishSnapshot()
        })

        const unregisterUpdateListener = editor.registerUpdateListener(
            ({dirtyElements, dirtyLeaves, tags}) => {
                // Skip selection-only updates; we only need snapshots for content/language changes.
                if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                    if (DEBUG_SKIP_UPDATE_LOGS) {
                        log("skipUpdate", {
                            editorId: config.editorId,
                            reason: "selection-only",
                        })
                    }
                    return
                }
                if (tags.has(ENTER_KEY_UPDATE_TAG)) {
                    setCurrentEditorId(config.editorId)
                    schedulePublish("enter")
                    return
                }
                if (tags.has(HIGHLIGHT_ONLY_UPDATE_TAG)) {
                    if (DEBUG_SKIP_UPDATE_LOGS) {
                        log("skipUpdate", {
                            editorId: config.editorId,
                            reason: "highlight-only",
                        })
                    }
                    return
                }
                if (tags.has("segment-rebalance")) {
                    if (DEBUG_SKIP_UPDATE_LOGS) {
                        log("skipUpdate", {
                            editorId: config.editorId,
                            reason: "segment-rebalance",
                        })
                    }
                    return
                }
                log("update", {
                    editorId: config.editorId,
                    dirtyElements: dirtyElements.size,
                    dirtyLeaves: dirtyLeaves.size,
                })

                setCurrentEditorId(config.editorId)
                schedulePublish("regular")
            },
        )

        return () => {
            log("cleanup", {
                editorId: config.editorId,
                editorKey: editor.getKey(),
            })
            clearScheduledPublish()
            unregisterUpdateListener()
        }
    },
})
