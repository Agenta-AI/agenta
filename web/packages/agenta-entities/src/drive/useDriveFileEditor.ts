/**
 * useDriveFileEditor — a file's editable draft over its content query. Drafts live in module
 * atoms keyed by mount + path, so navigating away and back (or closing the pane) keeps an
 * unsaved edit; the host mounts {@link useDriveDirtyGuard} once so a tab close still warns.
 *
 * The draft model ({@link driveDraft}) baselines on the editor's own first serialisation, not on
 * the file text — see that module for why.
 */
import {useCallback, useEffect, useState} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {type Mount, mountFileContentQueryFamily} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"

import {
    applyDriveDraftChange,
    commitDriveDraft,
    type DriveDraft,
    isDriveDraftDirty,
    revertDriveDraft,
    seedDriveDraft,
} from "./driveDraft"
import {refreshMountListing, saveMountText} from "./driveWrites"

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
    const [error, setError] = useState<string | null>(null)

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
    const revert = useCallback(() => setDraft((d) => (d ? revertDriveDraft(d) : d)), [setDraft])
    const save = useCallback(async () => {
        if (!mount || !draft || !isDriveDraftDirty(draft)) return false
        setSaving(true)
        setError(null)
        try {
            await saveMountText({mount, path, projectId, text: draft.value})
            setDraft(commitDriveDraft(draft))
            refreshMountListing(queryClient, projectId)
            return true
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't save the file")
            return false
        } finally {
            setSaving(false)
        }
    }, [mount, draft, path, projectId, queryClient, setDraft])

    return {
        /** The text to hand the editor; null while the file is still loading. */
        value: draft?.value ?? null,
        /** Bumps on every revert / re-seed so a controlled editor re-hydrates. */
        seed: draft?.seed ?? null,
        dirty: isDriveDraftDirty(draft),
        loading: query.isPending,
        failed: !query.isPending && fileText === null,
        saving,
        error,
        onChange,
        save,
        revert,
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
