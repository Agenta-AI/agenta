import {type RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    mountDirQueryFamily,
    mountDirQueryKey,
    mountFileContentQueryKey,
    queryMountDir,
    readMountFile,
} from "@agenta/entities/session"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {useDriveFileText} from "../driveFileSource"
import {resolveDriveFileKind, TEXT_CAP} from "../driveKinds"
import {parentOf} from "../driveTreeView"
import type {DriveScope} from "../driveTypes"
import type {ResolvedMountPath} from "../useSessionDrive"

import {saveDriveFile} from "./api"
import {
    driveEditAvailability,
    driveEditorLanguage,
    EDIT_KINDS,
    supportsMarkdownPreview,
    utf8ByteLength,
    type DriveEditAvailability,
} from "./model"
import {
    driveEditBufferAtom,
    driveEditBufferIdAtomFamily,
    driveEditDirtyAtomFamily,
    driveEditDirtyPathAtomFamily,
    driveEditDisplayPathAtomFamily,
    driveEditingAtomFamily,
    driveEditIssueAtomFamily,
    driveEditNavigationBlockedAtomFamily,
    driveEditPendingNavigationAtomFamily,
    driveEditSavingAtomFamily,
    editReloadFailedAtom,
    editSaveFailedAtom,
    editSaveSucceededAtom,
    markEditConflictAtom,
    markNavigationBlockedWhileSavingAtom,
    openEditBufferAtom,
    replaceBufferFromRemoteAtom,
    requestNavigationAtom,
    resolveNavigationAtom,
    setEditIssueAtom,
    startEditReloadAtom,
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
    rootRef,
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
    rootRef: RefObject<HTMLElement | null>
    registerNavigationRunner?: (runner: ((intent: NavigationIntent) => void) | null) => void
}): DriveEditController {
    const store = useStore()
    const queryClient = useAtomValue(queryClientAtom)
    const projectId = useAtomValue(projectIdAtom)
    const editing = useAtomValue(driveEditingAtomFamily(driveKey))
    const dirty = useAtomValue(driveEditDirtyAtomFamily(driveKey))
    const saving = useAtomValue(driveEditSavingAtomFamily(driveKey))
    const issue = useAtomValue(driveEditIssueAtomFamily(driveKey))
    const dirtyPath = useAtomValue(driveEditDirtyPathAtomFamily(driveKey))
    const navigationBlocked = useAtomValue(driveEditNavigationBlockedAtomFamily(driveKey))
    const openBuffer = useSetAtom(openEditBufferAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const startSave = useSetAtom(startEditSaveAtom)
    const saveSucceeded = useSetAtom(editSaveSucceededAtom)
    const saveFailed = useSetAtom(editSaveFailedAtom)
    const markConflict = useSetAtom(markEditConflictAtom)
    const setIssue = useSetAtom(setEditIssueAtom)
    const markNavigationBlocked = useSetAtom(markNavigationBlockedWhileSavingAtom)
    const [justSavedPath, setJustSavedPath] = useState<string | null>(null)
    const savedTimer = useRef<number | null>(null)
    const mounted = useRef(true)

    const kind = resolveDriveFileKind(selectedPath ?? "")
    const editableKind = EDIT_KINDS.has(kind) && !selectedIsFolder
    const selectedResolved =
        selectedPath && editableKind
            ? resolveMountPath(selectedPath)
            : (null as ResolvedMountPath | null)
    const knownTooLarge = selectedSize != null && selectedSize > TEXT_CAP
    const contentResolved = knownTooLarge ? null : selectedResolved
    const content = useDriveFileText(contentResolved?.mount ?? null, contentResolved?.path ?? "")
    const listingQuery = useAtomValue(
        mountDirQueryFamily({
            mountId: contentResolved?.mount.id ?? "",
            path: parentOf(contentResolved?.path ?? ""),
            includeGitignored,
        }),
    )
    const contentByteLength = useMemo(
        () => (typeof content.data === "string" ? utf8ByteLength(content.data) : null),
        [content.data],
    )
    const contentAvailability = driveEditAvailability({
        kind,
        listingSize: selectedSize,
        contentByteLength,
        isPending: content.isPending,
        isFetching: content.isFetching,
        canEdit: canEditMountFiles && Boolean(projectId && selectedResolved && selectedPath),
    })
    const availability =
        contentAvailability !== "enabled"
            ? contentAvailability
            : listingQuery.isPending || listingQuery.isFetching
              ? "loading"
              : Array.isArray(listingQuery.data)
                ? "enabled"
                : "listing-unavailable"

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
            const intent = requestNavigation({driveKey, intent: {kind: "select", path}})
            if (intent) runIntent(intent)
        },
        [driveKey, requestNavigation, runIntent, selectedPath],
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
            !selectedResolved ||
            typeof content.data !== "string" ||
            !Array.isArray(listingQuery.data)
        ) {
            return
        }
        const baseMtime =
            listingQuery.data.find((file) => file.path === selectedResolved.path)?.mtime ?? null
        setJustSavedPath(null)
        openBuffer({
            bufferId: newId(),
            driveKey,
            targetMountId: selectedResolved.mount.id,
            targetPath: selectedResolved.path,
            displayPath: selectedPath,
            scope,
            original: content.data,
            baseMtime,
            includeGitignored,
            supportsMarkdownPreview: supportsMarkdownPreview(selectedPath),
            language: driveEditorLanguage(selectedPath),
        })
    }, [
        availability,
        content.data,
        driveKey,
        includeGitignored,
        listingQuery.data,
        openBuffer,
        projectId,
        scope,
        selectedPath,
        selectedResolved,
    ])

    const save = useCallback(
        (skipConflictCheck: boolean) => {
            const current = store.get(driveEditBufferAtom)
            if (
                !current ||
                current.driveKey !== driveKey ||
                !projectId ||
                current.saveStatus === "saving" ||
                current.reloading ||
                current.draft === current.original
            ) {
                return
            }
            const requestId = newId()
            startSave(requestId)
            void saveDriveFile({
                queryClient,
                projectId,
                targetMountId: current.targetMountId,
                targetPath: current.targetPath,
                draft: current.draft,
                baseMtime: current.baseMtime,
                includeGitignored: current.includeGitignored,
                skipConflictCheck,
            })
                .then((result) => {
                    if (result.kind === "conflict") {
                        markConflict({
                            requestId,
                            reason: result.reason,
                            theirMtime: result.theirMtime,
                        })
                        return
                    }
                    if (result.kind === "error") {
                        saveFailed({requestId, message: result.message})
                        return
                    }
                    if (store.get(driveEditBufferAtom)?.inflightRequestId !== requestId) return
                    saveSucceeded(requestId)
                    if (!mounted.current) return
                    setJustSavedPath(current.displayPath)
                    if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
                    savedTimer.current = window.setTimeout(() => setJustSavedPath(null), 2_000)
                })
                .catch((error: unknown) => {
                    saveFailed({
                        requestId,
                        message: error instanceof Error ? error.message : "Couldn’t save this file",
                    })
                })
        },
        [
            driveKey,
            markConflict,
            projectId,
            queryClient,
            saveFailed,
            saveSucceeded,
            startSave,
            store,
        ],
    )

    const onSave = useCallback(() => save(false), [save])
    const onCancel = useCallback(() => {
        const current = store.get(driveEditBufferAtom)
        if (current?.driveKey === driveKey && current.saveStatus === "saving") {
            markNavigationBlocked(driveKey)
            return
        }
        const intent = requestNavigation({driveKey, intent: {kind: "cancel"}})
        if (intent) runIntent(intent)
    }, [driveKey, markNavigationBlocked, requestNavigation, runIntent, store])
    const onReload = useCallback(() => {
        const intent = requestNavigation({driveKey, intent: {kind: "reload"}})
        if (intent) runIntent(intent)
    }, [driveKey, requestNavigation, runIntent])
    const onOverwrite = useCallback(() => {
        setIssue({driveKey, issue: null})
        save(true)
    }, [driveKey, save, setIssue])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) return
            if (store.get(driveEditPendingNavigationAtomFamily(driveKey))) return
            const command = event.metaKey || event.ctrlKey
            if (command && event.key.toLowerCase() === "e" && availability === "enabled") {
                event.preventDefault()
                onEdit()
                return
            }
            if (command && event.key.toLowerCase() === "s" && editing) {
                event.preventDefault()
                onSave()
                return
            }
            if (event.key === "Escape" && editing) {
                event.preventDefault()
                event.stopPropagation()
                onCancel()
            }
        }
        window.addEventListener("keydown", onKeyDown, true)
        return () => window.removeEventListener("keydown", onKeyDown, true)
    }, [availability, driveKey, editing, onCancel, onEdit, onSave, rootRef, store])

    useEffect(() => {
        if (!dirty) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [dirty])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            const current = store.get(driveEditBufferAtom)
            if (
                current?.driveKey === driveKey &&
                !isDirtyBuffer(current) &&
                !current.issue &&
                current.saveStatus !== "saving" &&
                !current.reloading
            ) {
                store.set(driveEditBufferAtom, null)
            }
            if (savedTimer.current != null) window.clearTimeout(savedTimer.current)
        }
    }, [driveKey, store])

    const justSaved = justSavedPath === selectedPath
    const statusText = saving
        ? navigationBlocked
            ? "Saving — wait before leaving"
            : "Saving"
        : justSaved
          ? "Saved"
          : issue?.kind === "error"
            ? issue.message
            : issue?.kind === "conflict"
              ? "This file changed while you were editing"
              : ""

    return {
        availability,
        editing,
        dirty,
        saving,
        justSaved,
        statusText,
        dirtyPath,
        onEdit,
        onSave,
        onCancel,
        onReload,
        onOverwrite,
        select: guardedSelect,
    }
}

const isDirtyBuffer = (buffer: {original: string; draft: string}) =>
    buffer.original !== buffer.draft

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
    const ownerDriveKey = heldDriveKey
    const store = useStore()
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useAtomValue(queryClientAtom)
    const editing = useAtomValue(driveEditingAtomFamily(ownerDriveKey))
    const dirty = useAtomValue(driveEditDirtyAtomFamily(ownerDriveKey))
    const bufferId = useAtomValue(driveEditBufferIdAtomFamily(ownerDriveKey))
    const saving = useAtomValue(driveEditSavingAtomFamily(ownerDriveKey))
    const pendingNavigation = useAtomValue(driveEditPendingNavigationAtomFamily(ownerDriveKey))
    const displayPath = useAtomValue(driveEditDisplayPathAtomFamily(ownerDriveKey))
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const resolveNavigation = useSetAtom(resolveNavigationAtom)
    const replaceFromRemote = useSetAtom(replaceBufferFromRemoteAtom)
    const startReload = useSetAtom(startEditReloadAtom)
    const reloadFailed = useSetAtom(editReloadFailedAtom)
    const markNavigationBlocked = useSetAtom(markNavigationBlockedWhileSavingAtom)
    const [heldInitialPath, setHeldInitialPath] = useState(initialPath)
    const previousInitialPath = useRef(initialPath)
    const requestedDriveSwap = useRef<string | null>(null)
    const pendingDriveSwap = useRef(false)
    const holdDrive = Boolean(active && editing && driveKey !== heldDriveKey)

    useEffect(() => {
        if (!active) {
            if (!store.get(driveEditBufferAtom) || !editing) {
                previousInitialPath.current = initialPath
                setHeldInitialPath(initialPath)
            }
            return
        }
        if (previousInitialPath.current === initialPath) return
        previousInitialPath.current = initialPath
        const current = store.get(driveEditBufferAtom)
        if (!current || current.driveKey !== ownerDriveKey) {
            setHeldInitialPath(initialPath)
            return
        }
        const intent = requestNavigation({
            driveKey: ownerDriveKey,
            intent: {kind: "select", path: initialPath ?? null},
        })
        if (intent?.kind === "select") {
            setHeldInitialPath(intent.path)
            runNavigation(intent)
        }
    }, [active, editing, initialPath, ownerDriveKey, requestNavigation, runNavigation, store])

    useEffect(() => {
        if (!holdDrive || !bufferId) {
            if (!bufferId) requestedDriveSwap.current = null
            if (!holdDrive) pendingDriveSwap.current = false
            return
        }
        if (saving) return
        const token = `${bufferId}:${driveKey}`
        if (requestedDriveSwap.current === token) return
        requestedDriveSwap.current = token
        pendingDriveSwap.current = true
        requestNavigation({
            driveKey: ownerDriveKey,
            intent: {kind: "select", path: initialPath ?? null},
        })
    }, [bufferId, driveKey, holdDrive, initialPath, ownerDriveKey, requestNavigation, saving])

    useEffect(() => {
        if (!editing) setHeldInitialPath(initialPath)
    }, [editing, initialPath])

    const guardedClose = useCallback(() => {
        if (!active) return
        const current = store.get(driveEditBufferAtom)
        if (current?.driveKey === ownerDriveKey && current.saveStatus === "saving") {
            markNavigationBlocked(ownerDriveKey)
            return
        }
        if (requestNavigation({driveKey: ownerDriveKey, intent: {kind: "close"}})) onClose()
    }, [active, markNavigationBlocked, onClose, ownerDriveKey, requestNavigation, store])

    const keepEditing = useCallback(() => {
        const current = store.get(driveEditBufferAtom)
        const ownedBufferId = current?.driveKey === ownerDriveKey ? current.bufferId : null
        resolveNavigation({driveKey: ownerDriveKey, resolution: "keep"})
        if (ownedBufferId) focusEditor(ownedBufferId)
    }, [ownerDriveKey, resolveNavigation, store])

    const discard = useCallback(() => {
        const current = store.get(driveEditBufferAtom)
        if (!current || current.driveKey !== ownerDriveKey) return
        const intent = resolveNavigation({driveKey: ownerDriveKey, resolution: "discard"})
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
        if (intent.kind !== "reload" || !projectId) return

        const requestId = newId()
        startReload(requestId)
        const canAdoptReload = () => {
            const live = store.get(driveEditBufferAtom)
            return Boolean(
                live?.driveKey === ownerDriveKey &&
                live.bufferId === current.bufferId &&
                live.reloading &&
                live.inflightReloadRequestId === requestId,
            )
        }
        void (async () => {
            const content = await queryClient.fetchQuery({
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
            if (!canAdoptReload()) return
            if (typeof content !== "string") throw new Error("Couldn’t reload this file")
            const directory = parentOf(current.targetPath)
            const listing = await queryClient.fetchQuery({
                queryKey: mountDirQueryKey(
                    projectId,
                    current.targetMountId,
                    directory,
                    current.includeGitignored,
                ),
                queryFn: ({signal}) =>
                    queryMountDir({
                        projectId,
                        mountId: current.targetMountId,
                        path: directory,
                        withCounts: true,
                        includeGitignored: current.includeGitignored,
                        abortSignal: signal,
                    }),
                staleTime: 0,
            })
            if (!canAdoptReload()) return
            const mtime = listing?.find((file) => file.path === current.targetPath)?.mtime ?? null
            replaceFromRemote({requestId, content, mtime})
            focusEditor(current.bufferId)
        })().catch(() => {
            if (!canAdoptReload()) return
            reloadFailed({requestId, message: "Couldn’t reload this file"})
        })
    }, [
        onClose,
        ownerDriveKey,
        projectId,
        queryClient,
        reloadFailed,
        replaceFromRemote,
        resolveNavigation,
        runNavigation,
        startReload,
        store,
    ])

    useEffect(() => {
        if (active && !dirty && pendingNavigation?.kind === "reload") discard()
    }, [active, dirty, discard, pendingNavigation])

    return {
        initialPath: heldInitialPath,
        holdDrive,
        onClose: guardedClose,
        modal: {
            open:
                active &&
                pendingNavigation !== null &&
                (dirty || pendingNavigation.kind !== "reload"),
            saving,
            displayPath,
            onKeep: keepEditing,
            onDiscard: discard,
        },
    }
}
