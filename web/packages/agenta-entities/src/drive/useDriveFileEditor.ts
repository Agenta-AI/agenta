/**
 * useDriveFileEditor — a file's editable draft over its content query, saved on its own: every
 * edit re-arms a short timer and the draft writes when it lapses (or at once on `Cmd/Ctrl+S`,
 * and when the editor for the file is left while an edit is pending). Drafts live in module
 * atoms keyed by mount + path, so navigating away and back (or closing the pane) keeps an edit
 * the write hasn't caught up with; the host mounts {@link useDriveDirtyGuard} once so a tab
 * close still warns.
 *
 * The draft model ({@link driveDraft}) counts an edit only once the editor has emitted one — see
 * that module for why.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {type Mount, mountFileContentQueryFamily} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"

import {
    applyDriveDraftChange,
    commitDriveDraft,
    type DriveDraft,
    driveDraftTextToSave,
    isDriveDraftDirty,
    seedDriveDraft,
} from "./driveDraft"
import {refreshMountListing, saveMountText} from "./driveWrites"

/** Idle time after the last edit before the draft writes. */
export const DRIVE_AUTOSAVE_DELAY_MS = 1500
/** How long "Saved" stays up after a write. */
const SAVED_FLASH_MS = 2000

/** What row 2 says about the draft. */
export type DriveSaveStatus = "clean" | "pending" | "saving" | "saved" | "error"

const draftKey = (mountId: string, path: string) => `${mountId}:${path}`

const driveDraftAtomFamily = atomFamily((_key: string) => atom<DriveDraft | null>(null))
/** Keys with a draft — the dirty guard derives "anything unsaved?" from these. */
const draftKeysAtom = atom<string[]>([])

const anyDriveDraftDirtyAtom = atom((get) =>
    get(draftKeysAtom).some((key) => isDriveDraftDirty(get(driveDraftAtomFamily(key)))),
)

export function useDriveFileEditor(mount: Mount | null, path: string) {
    const mountId = mount?.id ?? ""
    const key = draftKey(mountId, path)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useAtomValue(queryClientAtom)
    const query = useAtomValue(mountFileContentQueryFamily({mountId, path}))
    const [draft, setDraft] = useAtom(driveDraftAtomFamily(key))
    const [, setKeys] = useAtom(draftKeysAtom)
    const [saving, setSaving] = useState(false)
    const [outcome, setOutcome] = useState<{ok: boolean; error?: string; at: number} | null>(
        null,
    )

    const fileText = typeof query.data === "string" ? query.data : null
    // Seed once the text lands; re-seed when a clean draft's file changed underneath it.
    useEffect(() => {
        if (fileText === null) return
        setDraft((d) => {
            if (d === null) return seedDriveDraft(fileText)
            if (d.seed !== fileText && !isDriveDraftDirty(d)) return seedDriveDraft(fileText)
            return d
        })
        setKeys((keys) => (keys.includes(key) ? keys : [...keys, key]))
    }, [fileText, key, setDraft, setKeys])

    const onChange = useCallback(
        (text: string) => setDraft((d) => (d ? applyDriveDraftChange(d, text) : d)),
        [setDraft],
    )

    const dirty = isDriveDraftDirty(draft)
    // The latest draft for the writers below — they run from timers and cleanups, not renders.
    const draftRef = useRef(draft)
    draftRef.current = draft
    const savingRef = useRef(false)

    /** Write the draft now. Resolves `{ok: true}` or `{ok: false, error}`. */
    const save = useCallback(async (): Promise<{ok: boolean; error?: string}> => {
        const current = draftRef.current
        if (!mount || !current || !isDriveDraftDirty(current) || savingRef.current)
            return {ok: false}
        const text = driveDraftTextToSave(current)
        savingRef.current = true
        setSaving(true)
        try {
            await saveMountText({mount, path, projectId, text})
            setDraft((d) => (d ? commitDriveDraft(d, text) : d))
            refreshMountListing(queryClient, projectId)
            setOutcome({ok: true, at: Date.now()})
            return {ok: true}
        } catch (e) {
            const error = e instanceof Error ? e.message : "Couldn't save the file"
            setOutcome({ok: false, error, at: Date.now()})
            return {ok: false, error}
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }, [mount, path, projectId, queryClient, setDraft])
    const saveRef = useRef(save)
    saveRef.current = save

    // Autosave: each edit re-arms the timer; a failed write waits for the next edit (or Cmd+S).
    const failed = outcome != null && !outcome.ok
    useEffect(() => {
        if (!dirty || saving || failed) return
        const timer = setTimeout(() => void saveRef.current(), DRIVE_AUTOSAVE_DELAY_MS)
        return () => clearTimeout(timer)
    }, [dirty, draft?.value, saving, failed])
    // A failed write's status clears on the next edit, so the timer re-arms.
    useEffect(() => {
        if (failed) setOutcome(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on edits only
    }, [draft?.value])
    // Leaving the file with an edit pending writes it at once rather than holding it in the atom.
    useEffect(
        () => () => {
            if (isDriveDraftDirty(draftRef.current)) void saveRef.current()
        },
        [key],
    )
    // "Saved" is a flash, not a state.
    const [now, setNow] = useState(0)
    useEffect(() => {
        if (!outcome?.ok) return
        const timer = setTimeout(() => setNow(Date.now()), SAVED_FLASH_MS)
        return () => clearTimeout(timer)
    }, [outcome])

    const status: DriveSaveStatus = saving
        ? "saving"
        : failed
          ? "error"
          : dirty
            ? "pending"
            : outcome?.ok && now < outcome.at + SAVED_FLASH_MS
              ? "saved"
              : "clean"

    return {
        /** The text to hand the editor; null while the file is still loading. */
        value: draft?.value ?? null,
        status,
        /** The last write's failure, while `status` is "error". */
        error: failed ? outcome.error : undefined,
        loading: query.isPending,
        failed: !query.isPending && fileText === null,
        onChange,
        /** Write now (Cmd/Ctrl+S, or Retry after a failure). */
        save,
    }
}

/** Mount once per host: warns before the tab unloads while any drive draft is unsaved. */
export function useDriveDirtyGuard() {
    const dirty = useAtomValue(anyDriveDraftDirtyAtom)
    useEffect(() => {
        if (!dirty) return
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [dirty])
}
