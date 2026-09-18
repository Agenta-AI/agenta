/**
 * A file's editable draft over its content query, autosaved: each edit re-arms a timer, and
 * leaving the file (or Cmd/Ctrl+S) writes at once. Drafts are module atoms keyed by mount + path;
 * the host mounts {@link useDriveDirtyGuard} once so a tab close still warns.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtom, useAtomValue, useSetAtom, useStore} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    type Mount,
    mountFileContentQueryFamily,
    mountFileContentQueryKey,
} from "@agenta/entities/session"

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
const DRIVE_AUTOSAVE_DELAY_MS = 1500
/** How long "Saved" stays up after a write. */
const SAVED_FLASH_MS = 2000
/** Above these a file opens read-only (272 KB of JS: 2.7 s to open, 260 ms per keystroke). */
export const DRIVE_CODE_EDIT_CAP = 96 * 1024
export const DRIVE_MARKDOWN_EDIT_CAP = 512 * 1024

/** What row 2 says about the draft. */
export type DriveSaveStatus = "clean" | "pending" | "saving" | "saved" | "error"

const draftKey = (mountId: string, path: string) => `${mountId}:${path}`

const driveDraftAtomFamily = atomFamily((_key: string) => atom<DriveDraft | null>(null))
/** Dirty as its own atom, so the explorer re-renders on the flip, not per keystroke. */
const driveDraftDirtyAtomFamily = atomFamily((key: string) =>
    atom((get) => isDriveDraftDirty(get(driveDraftAtomFamily(key)))),
)
/** Keys with a draft, for the dirty guard. */
const draftKeysAtom = atom<string[]>([])

const anyDriveDraftDirtyAtom = atom((get) =>
    get(draftKeysAtom).some((key) => isDriveDraftDirty(get(driveDraftAtomFamily(key)))),
)

/** Editors holding each draft; a draft is dropped only once none does. */
const draftHolders = new Map<string, number>()

/** Drop a draft nobody holds (else a long session keeps every file it ever opened). */
const releaseDraft = (store: ReturnType<typeof useStore>, key: string) => {
    if (draftHolders.get(key)) return
    // The atom stays in its family (a new instance would re-run every effect keyed on it).
    store.set(driveDraftAtomFamily(key), null)
    store.set(draftKeysAtom, (keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : keys))
}

/** The editor body's side of a draft: the text to mount and the change sink. */
export function useDriveFileDraft(mount: Mount | null, path: string) {
    const key = draftKey(mount?.id ?? "", path)
    const [draft, setDraft] = useAtom(driveDraftAtomFamily(key))
    const onChange = useCallback(
        (text: string) => setDraft((d) => (d ? applyDriveDraftChange(d, text) : d)),
        [setDraft],
    )
    return {
        /** Null while the file is still loading. */
        value: draft?.value ?? null,
        /** Changes only on a re-seed, never per edit. */
        seed: draft?.seed ?? null,
        onChange,
    }
}

/** The explorer's side: seeding, autosave and the save status (never subscribes to the text). */
export function useDriveFileEditor(mount: Mount | null, path: string) {
    const mountId = mount?.id ?? ""
    const key = draftKey(mountId, path)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useAtomValue(queryClientAtom)
    const store = useStore()
    const query = useAtomValue(mountFileContentQueryFamily({mountId, path}))
    const draftAtom = driveDraftAtomFamily(key)
    const setDraft = useSetAtom(draftAtom)
    const dirty = useAtomValue(driveDraftDirtyAtomFamily(key))
    const setKeys = useSetAtom(draftKeysAtom)
    const [saving, setSaving] = useState(false)
    const [outcome, setOutcome] = useState<{ok: boolean; error?: string; at: number} | null>(null)

    const fileText = typeof query.data === "string" ? query.data : null
    // Seed once the text lands; re-seed a clean draft whose file changed underneath.
    useEffect(() => {
        if (fileText === null) return
        setDraft((d) => {
            if (d === null) return seedDriveDraft(fileText)
            if (d.seed !== fileText && !isDriveDraftDirty(d)) return seedDriveDraft(fileText)
            return d
        })
        setKeys((keys) => (keys.includes(key) ? keys : [...keys, key]))
    }, [fileText, key, setDraft, setKeys])

    const savingRef = useRef(false)
    /** Write the draft now. */
    const save = useCallback(async (): Promise<{ok: boolean; error?: string}> => {
        const current = store.get(draftAtom)
        if (!mount || !current || !isDriveDraftDirty(current) || savingRef.current)
            return {ok: false}
        const text = driveDraftTextToSave(current)
        savingRef.current = true
        setSaving(true)
        try {
            await saveMountText({mount, path, projectId, text})
            setDraft((d) => (d ? commitDriveDraft(d, text) : d))
            // Previews read the content query: hand it the saved text instead of refetching.
            queryClient.setQueryData(mountFileContentQueryKey(projectId, mount.id, path), text)
            refreshMountListing(queryClient, projectId, {contents: false})
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
    }, [store, draftAtom, mount, path, projectId, queryClient, setDraft])
    const saveRef = useRef(save)
    saveRef.current = save
    /** Forget the draft (the file is being deleted). */
    const discard = useCallback(() => {
        store.set(draftAtom, null)
        setOutcome(null)
    }, [store, draftAtom])

    // Autosave via a store subscription (no render per keystroke); a failed write waits for the next edit.
    const failed = outcome != null && !outcome.ok
    const failedRef = useRef(failed)
    failedRef.current = failed
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null
        let lastValue = store.get(draftAtom)?.value
        const arm = () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => void saveRef.current(), DRIVE_AUTOSAVE_DELAY_MS)
        }
        const unsub = store.sub(draftAtom, () => {
            const d = store.get(draftAtom)
            if (!d || d.value === lastValue) return
            lastValue = d.value
            // Ref-guarded: an unconditional setState would render the explorer per keystroke.
            if (failedRef.current) setOutcome(null)
            if (isDriveDraftDirty(d)) arm()
        })
        if (dirty && !saving && !failed) arm()
        return () => {
            unsub()
            if (timer) clearTimeout(timer)
        }
    }, [store, draftAtom, dirty, saving, failed])
    // Leaving the file flushes a pending edit, then releases the draft. `save` is taken at setup:
    // by cleanup time the ref already holds the next file's.
    useEffect(() => {
        const flush = saveRef.current
        draftHolders.set(key, (draftHolders.get(key) ?? 0) + 1)
        return () => {
            draftHolders.set(key, (draftHolders.get(key) ?? 1) - 1)
            const release = () => {
                if (!isDriveDraftDirty(store.get(draftAtom))) releaseDraft(store, key)
            }
            if (isDriveDraftDirty(store.get(draftAtom))) void flush().then(release)
            else release()
        }
    }, [store, draftAtom, key])
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
        status,
        /** The last write's failure. */
        error: failed ? outcome.error : undefined,
        loading: query.isPending,
        failed: !query.isPending && fileText === null,
        /** Write now (Cmd/Ctrl+S, Retry). */
        save,
        discard,
    }
}

/** Mount once per host: warns before unload while any draft is unsaved. */
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
