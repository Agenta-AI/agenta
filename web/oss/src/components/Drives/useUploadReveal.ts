/**
 * useUploadReveal — an upload must never finish by vanishing. {@link useMountUpload} drops the
 * optimistic tile the moment the write lands and the real file takes its place from the refetched
 * listing — except when the drive's own filters hide it: a dotfile with hidden files off, or an
 * `.env` / build artefact the repo gitignores. The tile then blinks out into nothing, which reads as
 * a FAILED upload (it isn't) — the report that prompted this.
 *
 * So every completed batch toasts, and whatever the filters would have swallowed is REVEALED.
 * Hidden-ness is decidable from the path; git-ignored-ness is not (the listing simply omits the
 * entry), so a file that never arrives in a directory we have loaded AND settled is taken as
 * git-ignored: the toggle flips and the toast says why the view changed.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {type MountFile} from "@agenta/entities/session"
import {App} from "antd"

import {isHiddenPath} from "./driveTree"

/** How long a batch waits for its destination listing to settle before we rule on it, and the hard
 * stop after which an unconfirmed batch is dropped without a verdict (never flip a filter on a
 * guess). Both measured from the moment the upload landed. */
const SETTLE_MS = 1500
const GIVE_UP_MS = 6000
/** Uploads completing within this window toast as ONE message — a dropped folder is one event. */
const BATCH_MS = 300

const dirOf = (path: string) => {
    const slash = path.lastIndexOf("/")
    return slash === -1 ? "" : path.slice(0, slash)
}
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)

const label = (paths: string[]) =>
    paths.length === 1 ? `Uploaded ${nameOf(paths[0])}` : `Uploaded ${paths.length} files`

/** One toasted group of uploads, watched until its files show up in the listing. */
export interface UploadBatch {
    key: string
    /** Presented (drive-root-relative) paths — the same space the tree's files live in. */
    paths: string[]
    at: number
    /** The destination listing was seen refetching — the batch's cue that a verdict is meaningful. */
    sawFetch: boolean
}

/** What to do with a watched batch on this pass. `filtered` = the listing settled without it, so
 * only the gitignore filter can be hiding it; `unresolved` = we never got a settled listing to rule
 * against (an unsubscribed folder), so the batch is dropped WITHOUT touching a filter. */
export type BatchVerdict = "confirmed" | "filtered" | "waiting" | "unresolved"

/**
 * The rule for one watched batch — pure, so the (subtle) settle/give-up timing is testable.
 * A verdict is only meaningful once every destination directory is loaded and no longer in flight;
 * `sawFetch` catches the refetch the upload's own invalidation kicks off, and the age floor covers
 * the case where that refetch was too quick (or too inactive) to ever be observed.
 */
export function ruleOnBatch({
    batch,
    seen,
    loadedDirs,
    fetchingDirs,
    now,
}: {
    batch: UploadBatch
    /** Paths currently in the listing. */
    seen: ReadonlySet<string>
    loadedDirs: ReadonlySet<string>
    fetchingDirs: ReadonlySet<string>
    now: number
}): {verdict: BatchVerdict; sawFetch: boolean} {
    const missing = batch.paths.filter((p) => !seen.has(p))
    if (!missing.length) return {verdict: "confirmed", sawFetch: batch.sawFetch}
    const dirs = [...new Set(missing.map(dirOf))]
    const sawFetch = batch.sawFetch || dirs.some((d) => fetchingDirs.has(d))
    const age = now - batch.at
    const settled =
        dirs.every((d) => loadedDirs.has(d) && !fetchingDirs.has(d)) &&
        (sawFetch || age >= SETTLE_MS)
    if (settled) return {verdict: "filtered", sawFetch}
    if (age >= GIVE_UP_MS) return {verdict: "unresolved", sawFetch}
    return {verdict: "waiting", sawFetch}
}

export function useUploadReveal({
    files,
    loadedDirs,
    fetchingDirs,
    inGitScope,
    showHidden,
    setShowHidden,
    showGitignored,
    setShowGitignored,
}: {
    /** Raw lazy-tree files (pre hidden/origin filtering) — presence here means "the listing has it". */
    files: MountFile[]
    loadedDirs: Set<string>
    fetchingDirs: Set<string>
    inGitScope: boolean
    showHidden: boolean
    setShowHidden: (next: boolean) => void
    showGitignored: boolean
    setShowGitignored: (next: boolean) => void
}) {
    const {message} = App.useApp()
    const [batches, setBatches] = useState<UploadBatch[]>([])
    // Completed paths held for BATCH_MS so a folder drop toasts once, not once per file.
    const buffer = useRef<string[]>([])
    const flushTimer = useRef<number | null>(null)
    const seq = useRef(0)
    // Read inside the debounced flush, which must not re-key on every filter change.
    const showHiddenRef = useRef(showHidden)
    showHiddenRef.current = showHidden

    const flush = useCallback(() => {
        flushTimer.current = null
        const paths = buffer.current
        buffer.current = []
        if (!paths.length) return
        // Hidden-ness is knowable now, so reveal before the toast and say so in it.
        const revealHidden = !showHiddenRef.current && paths.some(isHiddenPath)
        if (revealHidden) setShowHidden(true)
        const key = `drive-upload-${(seq.current += 1)}`
        message.open({
            type: "success",
            key,
            content: revealHidden ? `${label(paths)} · showing hidden files` : label(paths),
        })
        setBatches((prev) => [...prev, {key, paths, at: Date.now(), sawFetch: false}])
    }, [message, setShowHidden])

    /** Call when one upload's write has landed, with its presented path. */
    const onUploaded = useCallback(
        (path: string) => {
            buffer.current.push(path)
            if (flushTimer.current == null) {
                flushTimer.current = window.setTimeout(flush, BATCH_MS)
            }
        },
        [flush],
    )

    // Batches age out on their own schedule, so drive the re-check off a ticker that runs ONLY while
    // something is being watched.
    const [ticks, tick] = useState(0)
    useEffect(() => {
        if (!batches.length) return
        const id = window.setInterval(() => tick((n) => n + 1), 400)
        return () => window.clearInterval(id)
    }, [batches.length])

    useEffect(() => {
        void ticks // re-check on every tick: the settle/give-up rulings below are age-based
        if (!batches.length) return
        const seen = new Set(files.map((f) => f.path))
        const now = Date.now()
        let revealed = false
        const next: UploadBatch[] = []
        for (const batch of batches) {
            const {verdict, sawFetch} = ruleOnBatch({batch, seen, loadedDirs, fetchingDirs, now})
            if (verdict === "filtered" && inGitScope && !showGitignored) {
                revealed = true
                message.open({
                    type: "success",
                    key: batch.key,
                    content: `${label(batch.paths)} · showing git-ignored files`,
                })
            }
            if (verdict !== "waiting") continue
            next.push(sawFetch === batch.sawFetch ? batch : {...batch, sawFetch})
        }
        if (revealed) setShowGitignored(true)
        if (next.length !== batches.length || next.some((b, i) => b !== batches[i]))
            setBatches(next)
    }, [
        ticks,
        batches,
        files,
        loadedDirs,
        fetchingDirs,
        inGitScope,
        showGitignored,
        setShowGitignored,
        message,
    ])

    useEffect(
        () => () => {
            if (flushTimer.current != null) window.clearTimeout(flushTimer.current)
        },
        [],
    )

    return onUploaded
}
