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
export const DRIVE_AUTOSAVE_DELAY_MS = 1500
/** How long "Saved" stays up after a write. */
const SAVED_FLASH_MS = 2000
/**
 * Above these sizes a file opens read-only: the editors hold the whole document as Lexical
 * nodes, and the code editor re-tokenises on every keystroke. Measured on /m: a 272 KB / 2 000
 * line JS file took 2.7 s to open and 260 ms per keystroke; a 1.4 MB one 17 s and 540 MB of heap.
 * Markdown is cheaper (a 409 KB document opened in 0.4 s, 86 ms per keystroke).
 */
export const DRIVE_CODE_EDIT_CAP = 96 * 1024
export const DRIVE_MARKDOWN_EDIT_CAP = 512 * 1024

/** What row 2 says about the draft. */
export type DriveSaveStatus = "clean" | "pending" | "saving" | "saved" | "error"

const draftKey = (mountId: string, path: string) => `${mountId}:${path}`

const driveDraftAtomFamily = atomFamily((_key: string) => atom<DriveDraft | null>(null))
/** Dirty as its own atom: the explorer re-renders when it flips, not on every keystroke. */
const driveDraftDirtyAtomFamily = atomFamily((key: string) =>
    atom((get) => isDriveDraftDirty(get(driveDraftAtomFamily(key)))),
)
/** Keys with a draft — the dirty guard derives "anything unsaved?" from these. */
const draftKeysAtom = atom<string[]>([])

const anyDriveDraftDirtyAtom = atom((get) =>
    get(draftKeysAtom).some((key) => isDriveDraftDirty(get(driveDraftAtomFamily(key)))),
)

/**
 * The editor body's side of a draft: the text to mount and the change sink. Subscribes to the
 * draft, so only the (cheap) body re-renders per keystroke.
 */
export function useDriveFileDraft(mount: Mount | null, path: string) {
    const key = draftKey(mount?.id ?? "", path)
    const [draft, setDraft] = useAtom(driveDraftAtomFamily(key))
    const onChange = useCallback(
        (text: string) => setDraft((d) => (d ? applyDriveDraftChange(d, text) : d)),
        [setDraft],
    )
    return {
        /** The current text; null while the file is still loading. */
        value: draft?.value ?? null,
        /** The saved text the draft was seeded from — changes only on a re-seed, never per edit. */
        seed: draft?.seed ?? null,
        onChange,
    }
}

/**
 * The explorer's side: seeding, autosave and the save status. Does NOT subscribe to the draft's
 * text — it watches the dirty flag (an atom of its own) and the store directly for the timer.
 */
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

    const savingRef = useRef(false)
    /** Write the draft now. Resolves `{ok: true}` or `{ok: false, error}`. */
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
            // The content query is what previews read (the HTML Preview mode): hand it the saved
            // text rather than refetching what was just written.
            queryClient.setQueryData(mountFileContentQueryKey(projectId, mount.id, path), text)
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
    }, [store, draftAtom, mount, path, projectId, queryClient, setDraft])
    const saveRef = useRef(save)
    saveRef.current = save

    // Autosave: each edit re-arms the timer (a store subscription, so no render per keystroke);
    // a failed write waits for the next edit or Cmd+S.
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
            // Guarded by the ref: an unconditional setState here would render the explorer once
            // per keystroke even when it bails out.
            if (failedRef.current) setOutcome(null)
            if (isDriveDraftDirty(d)) arm()
        })
        if (dirty && !saving && !failed) arm()
        return () => {
            unsub()
            if (timer) clearTimeout(timer)
        }
    }, [store, draftAtom, dirty, saving, failed])
    // Leaving the file with an edit pending writes it at once rather than holding it in the atom.
    useEffect(
        () => () => {
            if (isDriveDraftDirty(store.get(draftAtom))) void saveRef.current()
        },
        [store, draftAtom],
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
        status,
        /** The last write's failure, while `status` is "error". */
        error: failed ? outcome.error : undefined,
        loading: query.isPending,
        failed: !query.isPending && fileText === null,
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
