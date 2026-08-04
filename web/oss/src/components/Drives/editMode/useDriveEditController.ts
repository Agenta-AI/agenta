import {useCallback, useEffect, useRef, useState} from "react"

import {
    mountDirQueryFamily,
    mountFileContentQueryKey,
    readMountFile,
} from "@agenta/entities/session"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {useDriveFileText} from "../driveFileSource"
import {resolveDriveFileKind} from "../driveKinds"
import {parentOf} from "../driveTreeView"
import type {DriveScope} from "../driveTypes"
import type {ResolvedMountPath} from "../useSessionDrive"

import {saveDriveFile} from "./api"
import {
    driveEditAvailability,
    driveEditBufferMode,
    driveEditorLanguage,
    EDIT_KINDS,
    type DriveEditAvailability,
} from "./model"
import {
    driveEditBufferAtom,
    driveEditFacetsAtom,
    editSaveFailedAtom,
    editSaveSucceededAtom,
    markEditConflictAtom,
    openEditBufferAtom,
    overwriteNextSaveAtom,
    replaceBufferFromRemoteAtom,
    requestNavigationAtom,
    resolveNavigationAtom,
    startEditSaveAtom,
    type NavigationIntent,
} from "./state"

const newId = (): string =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const focusEditor = (bufferId: string) => {
    requestAnimationFrame(() => {
        document
            .querySelector<HTMLElement>(
                `[data-drive-edit-buffer="${bufferId}"] .agenta-shared-editor [contenteditable='true']`,
            )
            ?.focus()
    })
}

export interface DriveEditController {
    availability: DriveEditAvailability
    editing: boolean
    dirty: boolean
    saving: boolean
    justSaved: boolean
    statusText: string
    dirtyPath: string | null
    onEdit: () => void
    onSave: () => void
    onCancel: () => void
    onReload: () => void
    onOverwrite: () => void
    select: (path: string | null) => void
}

export function useDriveEditController({
    driveKey,
    resolveMountPath,
    selectedPath,
    selectedIsFolder,
    selectedSize,
    scope,
    canEditMountFiles,
    includeGitignored,
    select,
    close,
    registerNavigationRunner,
}: {
    driveKey: string
    resolveMountPath: (displayPath: string) => ResolvedMountPath | null
    selectedPath: string | null
    selectedIsFolder: boolean
    selectedSize: number | null
    scope: DriveScope
    canEditMountFiles: boolean
    includeGitignored: boolean
    select: (path: string | null) => void
    close: () => void
    registerNavigationRunner?: (runner: ((intent: NavigationIntent) => void) | null) => void
}): DriveEditController {
    const store = useStore()
    const queryClient = useAtomValue(queryClientAtom)
    const projectId = useAtomValue(projectIdAtom)
    const buffer = useAtomValue(driveEditBufferAtom)
    const facets = useAtomValue(driveEditFacetsAtom)
    const openBuffer = useSetAtom(openEditBufferAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const startSave = useSetAtom(startEditSaveAtom)
    const saveSucceeded = useSetAtom(editSaveSucceededAtom)
    const saveFailed = useSetAtom(editSaveFailedAtom)
    const markConflict = useSetAtom(markEditConflictAtom)
    const overwriteNextSave = useSetAtom(overwriteNextSaveAtom)
    const [justSavedPath, setJustSavedPath] = useState<string | null>(null)
    const saveController = useRef<{
        controller: AbortController
        requestId: string
    } | null>(null)
    const savedTimer = useRef<number | null>(null)

    const kind = resolveDriveFileKind(selectedPath ?? "")
    const editableKind = EDIT_KINDS.has(kind) && !selectedIsFolder
    const resolved =
        selectedPath && editableKind
            ? resolveMountPath(selectedPath)
            : (null as ResolvedMountPath | null)
    const content = useDriveFileText(resolved?.mount ?? null, resolved?.path ?? "")
    const listingQuery = useAtomValue(
        mountDirQueryFamily({
            mountId: resolved?.mount.id ?? "",
            path: parentOf(resolved?.path ?? ""),
            includeGitignored,
        }),
    )
    const contentAvailability = driveEditAvailability({
        kind,
        listingSize: selectedSize,
        contentLength: typeof content.data === "string" ? content.data.length : null,
        isPending: content.isPending,
        canEdit: canEditMountFiles && Boolean(projectId && resolved && selectedPath),
    })
    const availability =
        contentAvailability !== "enabled"
            ? contentAvailability
            : listingQuery.isPending
              ? "loading"
              : Array.isArray(listingQuery.data)
                ? "enabled"
                : "unreadable"

    const runIntent = useCallback(
        (intent: NavigationIntent) => {
            if (intent.kind === "select") select(intent.path)
            if (intent.kind === "close") close()
        },
        [close, select],
    )

    const guardedSelect = useCallback(
        (path: string | null) => {
            if (path === selectedPath) return
            const intent = requestNavigation({kind: "select", path})
            if (intent) runIntent(intent)
        },
        [requestNavigation, runIntent, selectedPath],
    )

    useEffect(() => {
        registerNavigationRunner?.(runIntent)
        return () => registerNavigationRunner?.(null)
    }, [registerNavigationRunner, runIntent])

    const onEdit = useCallback(() => {
        if (
            availability !== "enabled" ||
            !projectId ||
            !selectedPath ||
            !resolved ||
            typeof content.data !== "string" ||
            !Array.isArray(listingQuery.data)
        ) {
            return
        }
        const baseMtime =
            listingQuery.data.find((file) => file.path === resolved.path)?.mtime ?? null
        setJustSavedPath(null)
        openBuffer({
            bufferId: newId(),
            driveKey,
            targetMountId: resolved.mount.id,
            targetPath: resolved.path,
            displayPath: selectedPath,
            scope,
            original: content.data,
            baseMtime,
            mode: driveEditBufferMode(selectedPath),
            language: driveEditorLanguage(selectedPath),
        })
    }, [
        availability,
        content.data,
        driveKey,
        listingQuery.data,
        openBuffer,
        projectId,
        resolved,
        scope,
        selectedPath,
    ])

    const onSave = useCallback(() => {
        const current = store.get(driveEditBufferAtom)
        if (
            !current ||
            !projectId ||
            current.saveStatus === "saving" ||
            current.draft === current.original
        ) {
            return
        }
        const requestId = newId()
        const controller = new AbortController()
        saveController.current?.controller.abort()
        saveController.current = {controller, requestId}
        const skipConflictCheck = current.skipConflictCheckOnce
        startSave(requestId)
        void saveDriveFile({
            queryClient,
            projectId,
            targetMountId: current.targetMountId,
            targetPath: current.targetPath,
            draft: current.draft,
            baseMtime: current.baseMtime,
            includeGitignored,
            skipConflictCheck,
            signal: controller.signal,
        })
            .then((result) => {
                if (result.kind === "conflict") {
                    markConflict({requestId, reason: result.reason, theirMtime: result.theirMtime})
                    return
                }
                if (result.kind === "error") {
                    saveFailed({requestId, message: result.message})
                    return
                }
                if (store.get(driveEditBufferAtom)?.inflightRequestId !== requestId) return
                saveSucceeded(requestId)
                setJustSavedPath(current.displayPath)
                if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
                savedTimer.current = window.setTimeout(() => setJustSavedPath(null), 2_000)
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return
                saveFailed({
                    requestId,
                    message: error instanceof Error ? error.message : "Couldn’t save this file",
                })
            })
    }, [
        includeGitignored,
        markConflict,
        projectId,
        queryClient,
        saveFailed,
        saveSucceeded,
        startSave,
        store,
    ])

    const onCancel = useCallback(() => {
        if (store.get(driveEditBufferAtom)?.saveStatus === "saving") return
        const intent = requestNavigation({kind: "cancel"})
        if (intent) runIntent(intent)
    }, [requestNavigation, runIntent, store])
    const onReload = useCallback(() => {
        const intent = requestNavigation({kind: "reload"})
        if (intent) runIntent(intent)
    }, [requestNavigation, runIntent])
    const onOverwrite = useCallback(() => {
        overwriteNextSave()
        onSave()
    }, [onSave, overwriteNextSave])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (store.get(driveEditBufferAtom)?.pendingNavigation) return
            const command = event.metaKey || event.ctrlKey
            if (command && event.key.toLowerCase() === "e" && availability === "enabled") {
                event.preventDefault()
                onEdit()
                return
            }
            if (command && event.key.toLowerCase() === "s" && facets.editing) {
                event.preventDefault()
                onSave()
                return
            }
            if (event.key === "Escape" && facets.editing) {
                event.preventDefault()
                event.stopPropagation()
                onCancel()
            }
        }
        window.addEventListener("keydown", onKeyDown, true)
        return () => window.removeEventListener("keydown", onKeyDown, true)
    }, [availability, facets.editing, onCancel, onEdit, onSave, store])

    useEffect(() => {
        if (!facets.dirty) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [facets.dirty])

    useEffect(
        () => () => {
            const inflight = saveController.current
            inflight?.controller.abort()
            if (inflight) {
                store.set(editSaveFailedAtom, {
                    requestId: inflight.requestId,
                    message: "Save was interrupted",
                })
            }
            if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
        },
        [store],
    )

    const justSaved = justSavedPath === selectedPath
    const statusText = facets.saving
        ? "Saving"
        : justSaved
          ? "Saved"
          : facets.issue?.kind === "error"
            ? facets.issue.message
            : facets.issue?.kind === "conflict"
              ? "This file changed while you were editing"
              : ""

    return {
        availability,
        editing: facets.editing,
        dirty: facets.dirty,
        saving: facets.saving,
        justSaved,
        statusText,
        dirtyPath: facets.dirty ? (buffer?.displayPath ?? null) : null,
        onEdit,
        onSave,
        onCancel,
        onReload,
        onOverwrite,
        select: guardedSelect,
    }
}

export function useDriveEditGuard({
    active,
    initialPath,
    driveKey,
    heldDriveKey,
    onClose,
    runNavigation,
}: {
    active: boolean
    initialPath?: string | null
    driveKey: string
    heldDriveKey: string
    onClose: () => void
    runNavigation: (intent: NavigationIntent) => void
}) {
    const store = useStore()
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const buffer = useAtomValue(driveEditBufferAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const resolveNavigation = useSetAtom(resolveNavigationAtom)
    const replaceFromRemote = useSetAtom(replaceBufferFromRemoteAtom)
    const startSave = useSetAtom(startEditSaveAtom)
    const saveFailed = useSetAtom(editSaveFailedAtom)
    const [heldInitialPath, setHeldInitialPath] = useState(initialPath)
    const previousInitialPath = useRef(initialPath)
    const requestedDriveSwap = useRef<string | null>(null)
    const pendingDriveSwap = useRef(false)
    const reloadRequest = useRef<string | null>(null)
    const holdDrive = Boolean(active && buffer && driveKey !== heldDriveKey)

    useEffect(() => {
        if (!active) {
            if (!store.get(driveEditBufferAtom)) {
                previousInitialPath.current = initialPath
                setHeldInitialPath(initialPath)
            }
            return
        }
        if (previousInitialPath.current === initialPath) return
        previousInitialPath.current = initialPath
        const current = store.get(driveEditBufferAtom)
        if (!current) {
            setHeldInitialPath(initialPath)
            return
        }
        const intent = requestNavigation({kind: "select", path: initialPath ?? null})
        if (intent?.kind === "select") {
            setHeldInitialPath(intent.path)
            runNavigation(intent)
        }
    }, [active, initialPath, requestNavigation, runNavigation, store])

    useEffect(() => {
        if (!holdDrive || !buffer) {
            if (!buffer) requestedDriveSwap.current = null
            if (!holdDrive) pendingDriveSwap.current = false
            return
        }
        const token = `${buffer.bufferId}:${driveKey}`
        if (requestedDriveSwap.current === token) return
        requestedDriveSwap.current = token
        pendingDriveSwap.current = true
        requestNavigation({kind: "select", path: initialPath ?? null})
    }, [buffer, driveKey, holdDrive, initialPath, requestNavigation])

    useEffect(() => {
        if (!buffer) setHeldInitialPath(initialPath)
    }, [buffer, initialPath])

    const guardedClose = useCallback(() => {
        if (!active) return
        if (store.get(driveEditBufferAtom)?.saveStatus === "saving") return
        if (requestNavigation({kind: "close"})) onClose()
    }, [active, onClose, requestNavigation, store])

    const keepEditing = useCallback(() => {
        const bufferId = store.get(driveEditBufferAtom)?.bufferId
        resolveNavigation("keep")
        if (bufferId) focusEditor(bufferId)
    }, [resolveNavigation, store])

    const discard = useCallback(() => {
        const current = store.get(driveEditBufferAtom)
        const discardedDraft = current?.draft
        const intent = resolveNavigation("discard")
        if (!intent) return
        if (intent.kind === "close") {
            onClose()
            return
        }
        if (intent.kind === "select") {
            setHeldInitialPath(intent.path)
            if (!pendingDriveSwap.current) runNavigation(intent)
            pendingDriveSwap.current = false
            return
        }
        if (intent.kind !== "reload" || !current || !projectId) return

        const requestId = newId()
        reloadRequest.current = requestId
        const canAdoptReload = () => {
            const live = store.get(driveEditBufferAtom)
            return Boolean(
                reloadRequest.current === requestId &&
                live?.bufferId === current.bufferId &&
                live.draft === discardedDraft &&
                live.saveStatus === "idle" &&
                live.inflightRequestId === null &&
                live.issue?.kind === "conflict" &&
                current.issue?.kind === "conflict" &&
                live.issue.reason === current.issue.reason &&
                live.issue.theirMtime === current.issue.theirMtime,
            )
        }
        void queryClient
            .fetchQuery({
                queryKey: mountFileContentQueryKey(
                    projectId,
                    current.targetMountId,
                    current.targetPath,
                ),
                queryFn: ({signal}) =>
                    readMountFile({
                        projectId,
                        mountId: current.targetMountId,
                        path: current.targetPath,
                        abortSignal: signal,
                    }),
                staleTime: 0,
            })
            .then((content) => {
                // Drop a reload completion after the user has moved to another buffer.
                if (!canAdoptReload()) return
                reloadRequest.current = null
                if (typeof content !== "string") {
                    startSave(requestId)
                    saveFailed({requestId, message: "Couldn’t reload this file"})
                    return
                }
                const mtime = current.issue?.kind === "conflict" ? current.issue.theirMtime : null
                replaceFromRemote({content, mtime})
                focusEditor(current.bufferId)
            })
            .catch(() => {
                if (!canAdoptReload()) return
                reloadRequest.current = null
                startSave(requestId)
                saveFailed({requestId, message: "Couldn’t reload this file"})
            })
    }, [
        onClose,
        projectId,
        queryClient,
        replaceFromRemote,
        resolveNavigation,
        runNavigation,
        saveFailed,
        startSave,
        store,
    ])

    return {
        initialPath: heldInitialPath,
        holdDrive,
        onClose: guardedClose,
        modal: {
            open: active && Boolean(buffer?.pendingNavigation),
            saving: buffer?.saveStatus === "saving",
            displayPath: buffer?.displayPath ?? "",
            onKeep: keepEditing,
            onDiscard: discard,
        },
    }
}
