import type {CodeLanguage} from "@agenta/ui/editor"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

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
    includeGitignored: boolean
    supportsMarkdownPreview: boolean
    language: CodeLanguage
    editorView: "source" | "preview"
    saveStatus: "idle" | "saving"
    inflightRequestId: string | null
    reloading: boolean
    inflightReloadRequestId: string | null
    issue: EditIssue | null
    pendingNavigation: NavigationIntent | null
    navigationBlockedWhileSaving: boolean
    showTeardownNotice: boolean
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
    | "includeGitignored"
    | "supportsMarkdownPreview"
    | "language"
>

export const driveEditBufferAtom = atom<DriveEditBuffer | null>(null)

export const ownedEditBufferAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(
        driveEditBufferAtom,
        (buffer) => (buffer?.driveKey === driveKey ? buffer : null),
        Object.is,
    ),
)

export const driveEditingAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer !== null),
)
export const driveEditBufferIdAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.bufferId ?? null),
)
export const driveEditDirtyAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) =>
        buffer ? isEditDirty(buffer.original, buffer.draft) : false,
    ),
)
export const driveEditSavingAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.saveStatus === "saving"),
)
export const driveEditIssueAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.issue ?? null, Object.is),
)
export const driveEditDirtyPathAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) =>
        buffer && isEditDirty(buffer.original, buffer.draft) ? buffer.displayPath : null,
    ),
)
export const driveEditPendingNavigationAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(
        ownedEditBufferAtomFamily(driveKey),
        (buffer) => buffer?.pendingNavigation ?? null,
        Object.is,
    ),
)
export const driveEditDisplayPathAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.displayPath ?? ""),
)
export const driveEditTargetMountAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.targetMountId ?? ""),
)
export const driveEditTargetPathAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.targetPath ?? ""),
)
export const driveEditNavigationBlockedAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(
        ownedEditBufferAtomFamily(driveKey),
        (buffer) => buffer?.navigationBlockedWhileSaving ?? false,
    ),
)
export const driveEditPreviewCapabilityAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(
        ownedEditBufferAtomFamily(driveKey),
        (buffer) => buffer?.supportsMarkdownPreview ?? false,
    ),
)
export const driveEditorViewAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.editorView ?? "source"),
)
export const driveEditorLanguageAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(ownedEditBufferAtomFamily(driveKey), (buffer) => buffer?.language ?? "code"),
)
export const driveEditTeardownNoticeAtomFamily = atomFamily((driveKey: string) =>
    selectAtom(
        ownedEditBufferAtomFamily(driveKey),
        (buffer) => buffer?.showTeardownNotice ?? false,
    ),
)

export const openEditBufferAtom = atom(null, (get, set, input: OpenDriveEditBufferInput) => {
    if (get(driveEditBufferAtom)) return

    set(driveEditBufferAtom, {
        ...input,
        draft: input.original,
        editorView: "source",
        saveStatus: "idle",
        inflightRequestId: null,
        reloading: false,
        inflightReloadRequestId: null,
        issue: null,
        pendingNavigation: null,
        navigationBlockedWhileSaving: false,
        showTeardownNotice: false,
    })
})

export const setEditDraftAtom = atom(null, (get, set, input: {driveKey: string; draft: string}) => {
    const buffer = get(driveEditBufferAtom)
    if (
        !buffer ||
        buffer.driveKey !== input.driveKey ||
        buffer.saveStatus === "saving" ||
        buffer.reloading
    ) {
        return
    }

    set(driveEditBufferAtom, {...buffer, draft: input.draft})
})

export const setEditorViewAtom = atom(
    null,
    (get, set, input: {driveKey: string; editorView: DriveEditBuffer["editorView"]}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.driveKey !== input.driveKey) return

        set(driveEditBufferAtom, {...buffer, editorView: input.editorView})
    },
)

export const requestNavigationAtom = atom(
    null,
    (get, set, input: {driveKey: string; intent: NavigationIntent}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.driveKey !== input.driveKey) return input.intent

        if (isEditDirty(buffer.original, buffer.draft) || input.intent.kind === "reload") {
            set(driveEditBufferAtom, {...buffer, pendingNavigation: input.intent})
            return null
        }

        set(driveEditBufferAtom, null)
        return input.intent
    },
)

export const resolveNavigationAtom = atom(
    null,
    (get, set, input: {driveKey: string; resolution: "keep" | "discard"}) => {
        const buffer = get(driveEditBufferAtom)
        const intent = buffer?.driveKey === input.driveKey ? buffer.pendingNavigation : null
        if (!buffer || !intent) return null

        if (input.resolution === "keep") {
            set(driveEditBufferAtom, {...buffer, pendingNavigation: null})
            return null
        }

        if (intent.kind === "reload") {
            set(driveEditBufferAtom, {...buffer, pendingNavigation: null})
        } else {
            set(driveEditBufferAtom, null)
        }
        return intent
    },
)

export const startEditSaveAtom = atom(null, (get, set, requestId: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return

    set(driveEditBufferAtom, {
        ...buffer,
        saveStatus: "saving",
        inflightRequestId: requestId,
        issue: null,
        navigationBlockedWhileSaving: false,
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
            navigationBlockedWhileSaving: false,
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
            navigationBlockedWhileSaving: false,
        })
    },
)

export const setEditIssueAtom = atom(
    null,
    (get, set, input: {driveKey: string; issue: EditIssue | null}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.driveKey !== input.driveKey) return
        set(driveEditBufferAtom, {...buffer, issue: input.issue})
    },
)

export const startEditReloadAtom = atom(null, (get, set, requestId: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer) return
    set(driveEditBufferAtom, {
        ...buffer,
        reloading: true,
        inflightReloadRequestId: requestId,
    })
})

export const editReloadFailedAtom = atom(
    null,
    (get, set, input: {requestId: string; message: string}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.inflightReloadRequestId !== input.requestId) return
        set(driveEditBufferAtom, {
            ...buffer,
            reloading: false,
            inflightReloadRequestId: null,
            issue: {kind: "error", message: input.message},
        })
    },
)

export const replaceBufferFromRemoteAtom = atom(
    null,
    (get, set, input: {requestId: string; content: string; mtime: number | null}) => {
        const buffer = get(driveEditBufferAtom)
        if (!buffer || buffer.inflightReloadRequestId !== input.requestId) return

        set(driveEditBufferAtom, {
            ...buffer,
            original: input.content,
            draft: input.content,
            baseMtime: input.mtime,
            saveStatus: "idle",
            inflightRequestId: null,
            reloading: false,
            inflightReloadRequestId: null,
            issue: null,
            navigationBlockedWhileSaving: false,
        })
    },
)

export const markNavigationBlockedWhileSavingAtom = atom(null, (get, set, driveKey: string) => {
    const buffer = get(driveEditBufferAtom)
    if (
        !buffer ||
        buffer.driveKey !== driveKey ||
        buffer.saveStatus !== "saving" ||
        buffer.navigationBlockedWhileSaving
    ) {
        return
    }
    set(driveEditBufferAtom, {...buffer, navigationBlockedWhileSaving: true})
})

export const showTeardownNoticeAtom = atom(null, (get, set, driveKey: string) => {
    const buffer = get(driveEditBufferAtom)
    if (!buffer || buffer.driveKey !== driveKey || buffer.showTeardownNotice) return

    set(driveEditBufferAtom, {...buffer, showTeardownNotice: true})
})
