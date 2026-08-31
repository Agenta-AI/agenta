import {useEffect, useRef, useState} from "react"

import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {type AttachmentRejection} from "../assets"
import {isViewable} from "../assets/attachmentRules"
import {SESSION_SPRING} from "../assets/motion"
import type {StagedUpload as UploadFile} from "../model"

import AttachmentCard from "./AttachmentCard"
import AttachmentCardGrid from "./AttachmentCardGrid"

/** Three rows of cards plus a sliver of the fourth, which is what says "keep scrolling". */
const TRAY_MAX_HEIGHT = 140

/** Cards scale in on add and out on remove; `layout` slides the survivors into place. */
const ITEM_VARIANTS = {
    initial: {opacity: 0, scale: 0.85},
    animate: {opacity: 1, scale: 1},
    exit: {opacity: 0, scale: 0.85},
}

interface ComposerAttachmentsProps {
    files: UploadFile[]
    rejections: AttachmentRejection[]
    onRemove: (uid: string) => void
    onDismissRejection: (index: number) => void
    /** Open a viewable attachment (image/document) in the Files drawer. */
    onView?: (uid: string) => void
    /** Retry a failed upload (wired to the upload flow). */
    onRetry?: (uid: string) => void
    /** Whether this upload error can be retried. */
    canRetry?: (uid: string) => boolean
}

/**
 * The composer's staged attachments: a grid of equal-height cards holding the files and the
 * batch's rejections side by side, since a rejection is a thing you dismiss exactly like a file.
 * Picking and dropping are owned by the parent — this only draws what is staged.
 */
const ComposerAttachments = ({
    files,
    rejections,
    onRemove,
    onDismissRejection,
    onView,
    onRetry,
    canRetry,
}: ComposerAttachmentsProps) => {
    const [previews, setPreviews] = useState<Record<string, string>>({})

    // Object URLs for image thumbnails and audio playback, minted ONCE per uid and released only
    // when that row (or its blob) goes away. Keyed by uid rather than rebuilt from the array:
    // `files` gets a fresh identity on every upload progress tick, so re-minting on identity
    // change handed every <img> and <audio> a new src many times a second mid-upload.
    const urlsRef = useRef(new Map<string, {file: File; url: string}>())
    useEffect(() => {
        const urls = urlsRef.current
        const live = new Set<string>()
        let changed = false
        files.forEach((f) => {
            const file = f.originFileObj as File | undefined
            const type = file?.type || ""
            if (!file || !(type.startsWith("image/") || type.startsWith("audio/"))) return
            live.add(f.uid)
            const existing = urls.get(f.uid)
            if (existing?.file === file) return
            if (existing) URL.revokeObjectURL(existing.url)
            urls.set(f.uid, {file, url: URL.createObjectURL(file)})
            changed = true
        })
        for (const [uid, entry] of urls) {
            if (live.has(uid)) continue
            URL.revokeObjectURL(entry.url)
            urls.delete(uid)
            changed = true
        }
        if (!changed) return
        setPreviews(Object.fromEntries([...urls].map(([uid, entry]) => [uid, entry.url])))
    }, [files])
    // Release whatever is still held when the tray goes away.
    useEffect(() => {
        const urls = urlsRef.current
        return () => {
            urls.forEach((entry) => URL.revokeObjectURL(entry.url))
            urls.clear()
        }
    }, [])

    // A new card lands at the end of the grid, which may sit below the fold once the tray scrolls.
    const scrollRef = useRef<HTMLDivElement>(null)
    const previousCount = useRef(files.length)
    useEffect(() => {
        if (files.length > previousCount.current) {
            requestAnimationFrame(() => {
                const el = scrollRef.current
                if (el) el.scrollTop = el.scrollHeight
            })
        }
        previousCount.current = files.length
    }, [files.length])

    // Nothing staged means nothing to draw — the paperclip opens the picker directly, so there is
    // no empty state to invite a drop.
    if (files.length === 0 && rejections.length === 0) return null

    return (
        <MotionConfig transition={SESSION_SPRING}>
            <div className="flex flex-col gap-2 p-2">
                <AttachmentCardGrid ref={scrollRef} maxHeight={TRAY_MAX_HEIGHT}>
                    {/* popLayout: a removed card leaves the flow at once, so the rest close the
                        gap while it animates out rather than after. */}
                    <AnimatePresence initial={false} mode="popLayout">
                        {files.map((f) => {
                            const file = f.originFileObj as File | undefined
                            const type = file?.type || ""
                            const viewable = !!onView && isViewable(type)
                            const failed = f.status === "error"
                            return (
                                <motion.div
                                    key={f.uid}
                                    layout
                                    variants={ITEM_VARIANTS}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    className="min-w-0"
                                >
                                    <AttachmentCard
                                        name={f.name}
                                        mediaType={type}
                                        src={previews[f.uid]}
                                        state={
                                            failed
                                                ? "error"
                                                : f.status === "uploading"
                                                  ? "uploading"
                                                  : "idle"
                                        }
                                        progress={f.percent ?? 0}
                                        errorReason={
                                            typeof f.error === "string" ? f.error : "upload failed"
                                        }
                                        action="remove"
                                        onRemove={() => onRemove(f.uid)}
                                        onRetry={
                                            failed && onRetry && (canRetry?.(f.uid) ?? true)
                                                ? () => onRetry(f.uid)
                                                : undefined
                                        }
                                        onView={viewable ? () => onView(f.uid) : undefined}
                                    />
                                </motion.div>
                            )
                        })}

                        {/* Rejections never became files, so they carry no uid, and two can
                            agree on name AND reason — position is the only thing that separates
                            them. */}
                        {rejections.map((r, i) => (
                            <motion.div
                                key={`rejection-${i}-${r.name}`}
                                layout
                                variants={ITEM_VARIANTS}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="min-w-0"
                            >
                                <AttachmentCard
                                    name={r.name}
                                    mediaType=""
                                    state="error"
                                    errorReason={r.reason}
                                    action="remove"
                                    onRemove={() => onDismissRejection(i)}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </AttachmentCardGrid>
            </div>
        </MotionConfig>
    )
}

export default ComposerAttachments
