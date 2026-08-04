import type {CodeLanguage} from "@agenta/ui/editor"
import {atom} from "jotai"

import type {DriveScope} from "../driveTypes"

import {isEditDirty} from "./model"

export type EditIssue =
    | {kind: "error"; message: string}
    | {kind: "conflict"; reason: "changed" | "missing"; theirMtime: number | null}

export type NavigationIntent =
    | {kind: "cancel"}
    | {kind: "close"}
    | {kind: "select"; path: string | null}
    | {kind: "reload"}

export interface DriveEditBuffer {
    bufferId: string
    driveKey: string
    targetMountId: string
    targetPath: string
    displayPath: string
    scope: DriveScope
    original: string
    draft: string
    baseMtime: number | null
    mode: "markdown" | "code"
    language: CodeLanguage
    editorView: "source" | "preview"
    saveStatus: "idle" | "saving"
    inflightRequestId: string | null
    issue: EditIssue | null
    pendingNavigation: NavigationIntent | null
    skipConflictCheckOnce: boolean
    teardownWarned: boolean
}

export type OpenDriveEditBufferInput = Pick<
    DriveEditBuffer,
    | "bufferId"
    | "driveKey"
    | "targetMountId"
    | "targetPath"
    | "displayPath"
    | "scope"
    | "original"
    | "baseMtime"
    | "mode"
    | "language"
>

export interface DriveEditFacets {
    editing: boolean
    dirty: boolean
    saving: boolean
    mode: "markdown" | "code"
    editorView: "source" | "preview"
    issue: EditIssue | null
    guardOpen: boolean
}

export const driveEditBufferAtom = atom<DriveEditBuffer | null>(null)

export const driveEditFacetsAtom = atom<DriveEditFacets>((get) => {
    const buffer = get(driveEditBufferAtom)

    return {
        editing: buffer !== null,
        dirty: buffer ? isEditDirty(buffer.original, buffer.draft) : false,
        saving: buffer?.saveStatus === "saving",
        mode: buffer?.mode ?? "code",
        editorView: buffer?.editorView ?? "source",
        issue: buffer?.issue ?? null,
        guardOpen: Boolean(buffer?.pendingNavigation),
    }
})

export const openEditBufferAtom = atom(null, (get, set, input: OpenDriveEditBufferInput) => {
    if (get(driveEditBufferAtom)) return

    set(driveEditBufferAtom, {
        ...input,
        draft: input.original,
        editorView: "source",
        saveStatus: "idle",
        inflightRequestId: null,
        issue: null,
        pendingNavigation: null,
        skipConflictCheckOnce: false,
        teardownWarned: false,
    })
})

export const setEditDraftAtom = atom(null, (get, set, draft: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer || buffer.saveStatus === "saving") return

    set(driveEditBufferAtom, {...buffer, draft})
})

export const setEditorViewAtom = atom(
    null,
    (get, set, editorView: DriveEditBuffer["editorView"]) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer) return

        set(driveEditBufferAtom, {...buffer, editorView})
    },
)

/** Returns the intent to run now, or null when the guard took over. */
export const requestNavigationAtom = atom(null, (get, set, intent: NavigationIntent) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return intent

    if (isEditDirty(buffer.original, buffer.draft) || buffer.issue) {
        set(driveEditBufferAtom, {...buffer, pendingNavigation: intent})
        return null
    }

    set(driveEditBufferAtom, null)
    return intent
})

export const resolveNavigationAtom = atom(null, (get, set, resolution: "keep" | "discard") => {
    const buffer = get(driveEditBufferAtom)
    const intent = buffer?.pendingNavigation ?? null
    if (!buffer || !intent) return null

    if (resolution === "keep") {
        set(driveEditBufferAtom, {...buffer, pendingNavigation: null})
        return null
    }

    if (intent.kind === "reload") {
        set(driveEditBufferAtom, {...buffer, pendingNavigation: null})
    } else {
        set(driveEditBufferAtom, null)
    }
    return intent
})

export const startEditSaveAtom = atom(null, (get, set, requestId: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return

    set(driveEditBufferAtom, {
        ...buffer,
        saveStatus: "saving",
        inflightRequestId: requestId,
        issue: null,
        skipConflictCheckOnce: false,
    })
})

export const editSaveSucceededAtom = atom(null, (get, set, requestId: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer || buffer.inflightRequestId !== requestId) return

    set(driveEditBufferAtom, null)
})

export const editSaveFailedAtom = atom(
    null,
    (get, set, input: {requestId: string; message: string}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.inflightRequestId !== input.requestId) return

        set(driveEditBufferAtom, {
            ...buffer,
            saveStatus: "idle",
            inflightRequestId: null,
            issue: {kind: "error", message: input.message},
        })
    },
)

export const markEditConflictAtom = atom(
    null,
    (
        get,
        set,
        input: {
            requestId: string
            reason: "changed" | "missing"
            theirMtime: number | null
        },
    ) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.inflightRequestId !== input.requestId) return

        set(driveEditBufferAtom, {
            ...buffer,
            saveStatus: "idle",
            inflightRequestId: null,
            issue: {
                kind: "conflict",
                reason: input.reason,
                theirMtime: input.theirMtime,
            },
        })
    },
)

export const overwriteNextSaveAtom = atom(null, (get, set) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return

    set(driveEditBufferAtom, {...buffer, issue: null, skipConflictCheckOnce: true})
})

export const replaceBufferFromRemoteAtom = atom(
    null,
    (get, set, input: {content: string; mtime: number | null}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer) return

        set(driveEditBufferAtom, {
            ...buffer,
            original: input.content,
            draft: input.content,
            baseMtime: input.mtime,
            saveStatus: "idle",
            inflightRequestId: null,
            issue: null,
            skipConflictCheckOnce: false,
        })
    },
)

export const markTeardownWarnedAtom = atom(null, (get, set) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return

    set(driveEditBufferAtom, {...buffer, teardownWarned: true})
})
