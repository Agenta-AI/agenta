import {useEffect, useRef} from "react"

/**
 * Object-URL previews for a list of image files: created lazily per file, revoked when a file leaves
 * the list or the component unmounts. Non-image files are skipped. Returns a Map keyed by File whose
 * REFERENCE is stable across renders unless the previewed set changes — so it's safe to pass straight
 * into downstream `useMemo` deps without causing per-render churn.
 *
 * Shared by the staged-file tiles (DriveExplorer) and in-flight uploads (useMountUpload), which both
 * previously hand-rolled the same create/revoke dance.
 */
export function useImagePreviews(files: File[]): Map<File, string> {
    const ref = useRef(new Map<File, string>())
    const cur = ref.current
    const next = new Map<File, string>()
    let changed = false
    // Reuse existing URLs; mint one for each newly-seen image file.
    for (const f of files) {
        if (!f.type.startsWith("image/")) continue
        const url = cur.get(f)
        if (url) next.set(f, url)
        else {
            next.set(f, URL.createObjectURL(f))
            changed = true
        }
    }
    // Revoke URLs for files no longer in the list.
    for (const [f, url] of cur) {
        if (!next.has(f)) {
            URL.revokeObjectURL(url)
            changed = true
        }
    }
    // Only swap the ref (new identity) when the set actually changed, so unrelated re-renders keep the
    // same Map instance. StrictMode-safe: the second render reuses the first's URLs (changed = false).
    if (changed) ref.current = next
    useEffect(
        () => () => {
            for (const url of ref.current.values()) URL.revokeObjectURL(url)
            ref.current.clear()
        },
        [],
    )
    return ref.current
}
