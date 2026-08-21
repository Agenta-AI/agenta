import {useEffect, useRef, useState, type ReactNode} from "react"

import {SimpleTooltip} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    File as FileIcon,
    FileText,
    Image as ImageIcon,
    ImageBroken,
    Plus,
    UploadSimple,
    WarningCircle,
    X,
} from "@phosphor-icons/react"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {
    acceptAttrFor,
    type AttachmentLimits,
    type AttachmentRejection,
    describeAccepted,
    formatBytes,
} from "../assets"
import {isViewable} from "../assets/attachmentRules"
import {SESSION_SPRING} from "../assets/motion"
import type {StagedUpload as UploadFile} from "../model"

import AudioPlayer from "./AudioPlayer"

/** Every tile is the same height, so a row mixing thumbnails, clips and file chips reads as one
 * band rather than a ragged line. */
const TILE = "h-12"

/** Items scale in on add and out on remove; `layout` on each one makes the survivors slide into
 * place instead of jumping. */
const ITEM_VARIANTS = {
    initial: {opacity: 0, scale: 0.85},
    animate: {opacity: 1, scale: 1},
    exit: {opacity: 0, scale: 0.85},
}

const iconForType = (mediaType: string) => {
    if (mediaType.startsWith("image/")) return ImageIcon
    if (mediaType === "application/pdf" || mediaType.startsWith("text/")) return FileText
    return FileIcon
}

/** Shared remove affordance so every tile type dismisses the same way. */
const RemoveButton = ({
    name,
    onRemove,
    overlay,
    persistent,
}: {
    name: string
    onRemove: () => void
    /** Sits on top of a thumbnail rather than inline in a chip. */
    overlay?: boolean
    /** Skips the hover reveal: on a scrimmed tile a hidden control reads as no control. */
    persistent?: boolean
}) => (
    <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={(e) => {
            e.stopPropagation()
            onRemove()
        }}
        className={
            overlay
                ? `absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.6)] text-white transition-opacity ${persistent ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`
                : "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-colorTextTertiary transition-colors hover:bg-colorFillTertiary hover:text-colorText"
        }
    >
        <X size={11} weight="bold" />
    </button>
)

/** Upload state drawn over a tile: a progress scrim while uploading, a retry-able error otherwise.
 * Reads antd's `UploadFile` fields, so the upload flow only has to set status/percent. */
const StatusOverlay = ({
    file,
    onRetry,
    canRetry,
    onRemove,
}: {
    file: UploadFile
    onRetry?: (uid: string) => void
    canRetry: boolean
    onRemove: () => void
}) => {
    if (file.status === "uploading") {
        const pct = Math.max(0, Math.min(100, Math.round(file.percent ?? 0)))
        return (
            <>
                <div className="pointer-events-none absolute inset-0 rounded-lg bg-[rgba(0,0,0,0.4)]" />
                <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5">
                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.3)]">
                        <div
                            className="h-full rounded-full bg-colorPrimary transition-[width] duration-150"
                            style={{width: `${pct}%`}}
                        />
                    </div>
                    <span className="text-[12px] font-medium tabular-nums text-white">{pct}%</span>
                </div>
            </>
        )
    }
    if (file.status === "error") {
        return (
            <SimpleTooltip title={typeof file.error === "string" ? file.error : "Upload failed"}>
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-colorErrorBg ring-1 ring-inset ring-colorError">
                    {onRetry && canRetry && (
                        <button
                            type="button"
                            aria-label={`Retry ${file.name}`}
                            onClick={(e) => {
                                e.stopPropagation()
                                onRetry(file.uid)
                            }}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-colorError text-white"
                        >
                            <ArrowClockwise size={14} weight="bold" />
                        </button>
                    )}
                    {/* The scrim covers the tile's own remove, so a failure must stay removable here. */}
                    <RemoveButton name={file.name} onRemove={onRemove} overlay persistent />
                </div>
            </SimpleTooltip>
        )
    }
    return null
}

/** Shared chip shell: fixed height, one border treatment, room for a trailing remove. Never
 * interactive itself — see `ViewSurface`. */
const Chip = ({
    children,
    className,
    interactive,
}: {
    children: ReactNode
    className?: string
    /** The chip contains a view affordance: light up its border on hover like a clickable tile. */
    interactive?: boolean
}) => (
    <div
        className={`flex ${TILE} items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-2 ${interactive ? "hover:border-colorBorder" : ""} ${className ?? ""}`}
    >
        {children}
    </div>
)

/**
 * The "open this attachment in the viewer" affordance: a real `<button>` when there is somewhere
 * to open it, an inert box otherwise.
 *
 * It wraps only the tile's CONTENT, never the whole tile — every tile also carries a Remove
 * `<button>`, and a button inside a button is invalid and unreachable. So the two interactive
 * parts are siblings. (Previously the tile itself took `role="button"` + `onClick` with no
 * `tabIndex` and no key handling, which left the view action keyboard-inaccessible entirely.)
 */
const ViewSurface = ({
    onView,
    name,
    className,
    children,
}: {
    onView?: () => void
    name: string
    className?: string
    children: ReactNode
}) =>
    onView ? (
        <button
            type="button"
            aria-label={`View ${name}`}
            onClick={onView}
            className={`cursor-pointer border-0 bg-transparent p-0 text-left ${className ?? ""}`}
        >
            {children}
        </button>
    ) : (
        <div className={className}>{children}</div>
    )

interface ComposerAttachmentsProps {
    files: UploadFile[]
    rejections: AttachmentRejection[]
    limits: AttachmentLimits
    /** Add picked files through the caller's guardrails (`validateIncoming`). */
    onAdd: (incoming: File[]) => void
    onRemove: (uid: string) => void
    onDismissRejections: () => void
    /** Open a viewable attachment (image/document) in the Files drawer. */
    onView?: (uid: string) => void
    /** Retry a failed upload (wired to the upload flow). */
    onRetry?: (uid: string) => void
    /** Whether this upload error can be retried. */
    canRetry?: (uid: string) => boolean
}

/**
 * The composer's attachment panel: a borderless click/drop dropzone when empty, otherwise one band
 * of equal-height tiles — image thumbnails, playable audio clips and file chips — plus inline
 * rejection messages and a counter. Custom (not antd X `Attachments`) so the tiles stay small, the
 * surface has no nested border, and multi-select / multi-drop work. Drag-and-drop onto the whole
 * panel is owned by the parent; this renders the click path and the file list.
 */
const ComposerAttachments = ({
    files,
    rejections,
    limits,
    onAdd,
    onRemove,
    onDismissRejections,
    onView,
    onRetry,
    canRetry,
}: ComposerAttachmentsProps) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [previews, setPreviews] = useState<Record<string, string>>({})
    // Thumbnails whose object URL failed to decode (corrupt / unsupported image) — show a fallback.
    const [previewFailed, setPreviewFailed] = useState<Set<string>>(new Set())
    const atMax = files.length >= limits.maxCount

    // Object URLs for image previews and audio playback, minted ONCE per row and released only
    // when that row (or its blob) actually goes away.
    //
    // Keyed by uid rather than rebuilt from the array: `files` gets a fresh identity on every
    // upload progress tick (the tray's `patch` maps the whole list), so revoking and re-minting
    // whenever the identity changes ran many times a second mid-upload — which handed every <img>
    // and <audio> a new `src` each tick (thumbnail flicker, playback restarting from zero) and let
    // a decode against a just-revoked URL latch `previewFailed` for the rest of the session.
    const urlsRef = useRef(new Map<string, {file: File; url: string}>())
    useEffect(() => {
        const urls = urlsRef.current
        const live = new Set<string>()
        const remade: string[] = []
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
            remade.push(f.uid)
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
        // A fresh URL deserves a fresh attempt, and a gone row shouldn't keep its verdict —
        // otherwise nothing ever clears this and the fallback sticks.
        setPreviewFailed((prev) => {
            const next = new Set([...prev].filter((uid) => live.has(uid)))
            remade.forEach((uid) => next.delete(uid))
            return next.size === prev.size ? prev : next
        })
    }, [files])
    // Release whatever is still held when the tray goes away.
    useEffect(() => {
        const urls = urlsRef.current
        return () => {
            urls.forEach((entry) => URL.revokeObjectURL(entry.url))
            urls.clear()
        }
    }, [])

    // A newly added tile lands at the end of the band, which may be off-screen once the row
    // scrolls — bring it into view so attaching something always shows it. `scroll-smooth` on the
    // container is motion-safe, so this respects reduced-motion for free.
    const scrollRef = useRef<HTMLDivElement>(null)
    const previousCount = useRef(files.length)
    useEffect(() => {
        if (files.length > previousCount.current) {
            requestAnimationFrame(() => {
                const el = scrollRef.current
                if (el) el.scrollLeft = el.scrollWidth
            })
        }
        previousCount.current = files.length
    }, [files.length])

    const pick = () => inputRef.current?.click()
    const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files
        if (list && list.length) onAdd(Array.from(list))
        e.target.value = "" // let the same file be re-picked after a remove
    }

    return (
        <MotionConfig transition={SESSION_SPRING}>
            <div className="flex flex-col gap-2 p-2">
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={acceptAttrFor(limits)}
                    onChange={onInput}
                    className="hidden"
                />

                <AnimatePresence initial={false}>
                    {rejections.length > 0 && (
                        <motion.div
                            key="rejections"
                            initial={{opacity: 0, height: 0}}
                            animate={{opacity: 1, height: "auto"}}
                            exit={{opacity: 0, height: 0}}
                            className="overflow-hidden"
                        >
                            <div className="flex flex-col gap-1 rounded-md bg-colorErrorBg px-2.5 py-1.5">
                                {rejections.map((r) => (
                                    <div
                                        key={`${r.name}-${r.reason}`}
                                        className="flex items-center gap-1.5 text-xs text-colorError"
                                    >
                                        <WarningCircle
                                            size={13}
                                            weight="fill"
                                            className="shrink-0"
                                        />
                                        <span className="min-w-0 truncate">
                                            <span className="font-medium">{r.name}</span> {r.reason}
                                        </span>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={onDismissRejections}
                                    className="flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-0 py-0 text-xs text-colorError hover:underline"
                                >
                                    <X size={11} /> Dismiss
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {files.length === 0 ? (
                    <button
                        type="button"
                        onClick={pick}
                        className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border-0 bg-transparent px-3 py-3 text-center transition-colors hover:bg-colorFillQuaternary"
                    >
                        <UploadSimple size={18} className="text-colorTextTertiary" />
                        <span className="text-xs font-medium text-colorText">Attach files</span>
                        <span className="text-xs text-colorTextSecondary">
                            {describeAccepted(limits)} · up to {limits.maxCount} files
                        </span>
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        {/* One scrolling band rather than wrapping: five audio clips would otherwise
                        stack into five rows and push the composer down the screen. Mirrors the
                        session tag bar — contained overscroll so it can't chain to the page, and no
                        visible scrollbar under a 48px strip. */}
                        <div
                            ref={scrollRef}
                            className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain py-0.5 motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            {/* popLayout: a removed tile leaves the flow at once, so the rest close
                            the gap while it animates out rather than after. */}
                            <AnimatePresence initial={false} mode="popLayout">
                                {files.map((f) => {
                                    const file = f.originFileObj as File | undefined
                                    const type = file?.type || ""
                                    const Icon = iconForType(type)
                                    const size = file ? formatBytes(file.size) : ""
                                    const url = previews[f.uid]
                                    const remove = () => onRemove(f.uid)

                                    return (
                                        <motion.div
                                            key={f.uid}
                                            layout
                                            className="relative shrink-0"
                                            variants={ITEM_VARIANTS}
                                            initial="initial"
                                            animate="animate"
                                            exit="exit"
                                        >
                                            {type.startsWith("audio/") && url ? (
                                                <Chip className="w-[248px]">
                                                    <AudioPlayer
                                                        src={url}
                                                        name={f.name}
                                                        className="min-w-0 flex-1"
                                                    />
                                                    <RemoveButton name={f.name} onRemove={remove} />
                                                </Chip>
                                            ) : type.startsWith("image/") && url ? (
                                                <div
                                                    className={`group relative ${TILE} w-12 overflow-hidden rounded-lg border border-solid border-colorBorderSecondary`}
                                                >
                                                    <ViewSurface
                                                        onView={
                                                            onView ? () => onView(f.uid) : undefined
                                                        }
                                                        name={f.name}
                                                        className="block h-full w-full"
                                                    >
                                                        {previewFailed.has(f.uid) ? (
                                                            <div className="flex h-full w-full items-center justify-center bg-colorFillQuaternary text-colorTextTertiary">
                                                                <ImageBroken size={18} />
                                                            </div>
                                                        ) : (
                                                            /* Local object URL — next/image can't optimize a blob. */
                                                            <img
                                                                src={url}
                                                                alt={f.name}
                                                                onError={() =>
                                                                    setPreviewFailed((prev) =>
                                                                        new Set(prev).add(f.uid),
                                                                    )
                                                                }
                                                                className="h-full w-full object-cover"
                                                            />
                                                        )}
                                                    </ViewSurface>
                                                    <RemoveButton
                                                        name={f.name}
                                                        onRemove={remove}
                                                        overlay
                                                    />
                                                </div>
                                            ) : (
                                                <Chip
                                                    className="max-w-[200px]"
                                                    interactive={!!onView && isViewable(type)}
                                                >
                                                    <ViewSurface
                                                        onView={
                                                            onView && isViewable(type)
                                                                ? () => onView(f.uid)
                                                                : undefined
                                                        }
                                                        name={f.name}
                                                        className="flex min-w-0 flex-1 items-center gap-2"
                                                    >
                                                        <Icon
                                                            size={18}
                                                            className="shrink-0 text-colorTextSecondary"
                                                        />
                                                        <div className="flex min-w-0 flex-col">
                                                            <span
                                                                className="truncate text-xs text-colorText"
                                                                title={f.name}
                                                            >
                                                                {f.name}
                                                            </span>
                                                            {size && (
                                                                <span className="text-xs text-colorTextSecondary">
                                                                    {size}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </ViewSurface>
                                                    <RemoveButton name={f.name} onRemove={remove} />
                                                </Chip>
                                            )}
                                            <StatusOverlay
                                                file={f}
                                                onRetry={onRetry}
                                                canRetry={canRetry?.(f.uid) ?? true}
                                                onRemove={remove}
                                            />
                                        </motion.div>
                                    )
                                })}
                            </AnimatePresence>

                            {!atMax && (
                                <motion.div layout className="shrink-0">
                                    <SimpleTooltip title="Add more">
                                        <button
                                            type="button"
                                            onClick={pick}
                                            aria-label="Add more files"
                                            className={`flex ${TILE} w-12 cursor-pointer items-center justify-center rounded-lg border border-dashed border-colorBorder bg-transparent text-colorTextTertiary transition-colors hover:border-colorPrimary hover:bg-colorFillQuaternary hover:text-colorPrimary`}
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </SimpleTooltip>
                                </motion.div>
                            )}
                        </div>

                        {/* Outside the scroller: the count must stay put rather than scroll away. */}
                        <span className="shrink-0 text-xs tabular-nums text-colorTextTertiary">
                            {files.length} / {limits.maxCount}
                        </span>
                    </div>
                )}
            </div>
        </MotionConfig>
    )
}

export default ComposerAttachments
