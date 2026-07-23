import {useEffect, useRef, useState} from "react"

/**
 * Object-URL previews for a list of image files: created lazily per file, revoked when a file leaves
 * the list or the component unmounts. Non-image files are skipped. Returns a Map keyed by File whose
 * REFERENCE changes only when the previewed set changes — so it's safe in downstream `useMemo` deps
 * without per-render churn.
 *
 * `createObjectURL`/`revokeObjectURL` run ONLY in a commit effect, never in the render body: under
 * React 19 concurrent rendering a render can be discarded, and creating/revoking URLs there would
 * leak created ones or invalidate committed references. The live map lives in a ref (reconciled +
 * revoked-on-unmount in effects); a state snapshot is published so consumers still re-render when a
 * preview appears/disappears.
 *
 * Shared by the staged-file tiles (DriveExplorer) and in-flight uploads (useMountUpload), which both
 * previously hand-rolled the same create/revoke dance.
 */
export function useImagePreviews(files: File[]): Map<File, string> {
    // The live map — mutated only inside effects, and the source of truth for unmount revocation.
    const liveRef = useRef(new Map<File, string>())
    // What consumers read. A fresh instance is published whenever the previewed set changes.
    const [snapshot, setSnapshot] = useState<Map<File, string>>(liveRef.current)

    // Reconcile after every commit: mint URLs for newly-committed image files, revoke departed ones.
    // No dep array — the reconcile is cheap and the guarded setState makes it converge in one extra
    // commit (nothing to do → no state change → no re-render).
    useEffect(() => {
        const map = liveRef.current
        const wanted = files.filter((f) => f.type.startsWith("image/"))
        const wantedSet = new Set(wanted)
        let changed = false
        for (const f of wanted) {
            if (!map.has(f)) {
                map.set(f, URL.createObjectURL(f))
                changed = true
            }
        }
        for (const [f, url] of [...map]) {
            if (!wantedSet.has(f)) {
                URL.revokeObjectURL(url)
                map.delete(f)
                changed = true
            }
        }
        if (changed) setSnapshot(new Map(map))
    })

    // Revoke everything on unmount.
    useEffect(
        () => () => {
            for (const url of liveRef.current.values()) URL.revokeObjectURL(url)
            liveRef.current.clear()
        },
        [],
    )

    return snapshot
}
