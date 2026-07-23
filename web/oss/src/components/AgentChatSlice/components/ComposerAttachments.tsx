import {useEffect, useRef, useState, type ReactNode} from "react"

import {
    File as FileIcon,
    FileText,
    Image as ImageIcon,
    Plus,
    UploadSimple,
    WarningCircle,
    X,
} from "@phosphor-icons/react"
import {Tooltip, Typography} from "antd"
import type {UploadFile} from "antd"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {type AttachmentLimits, type AttachmentRejection, formatBytes} from "../assets/attachments"
import {SESSION_SPRING} from "../assets/sessionMotion"

import AudioPlayer from "./AudioPlayer"

const {Text} = Typography

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
}: {
    name: string
    onRemove: () => void
    /** Sits on top of a thumbnail rather than inline in a chip. */
    overlay?: boolean
}) => (
    <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className={
            overlay
                ? "absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.6)] text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                : "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-colorTextTertiary transition-colors hover:bg-colorFillTertiary hover:text-colorText"
        }
    >
        <X size={11} weight="bold" />
    </button>
)

/** Shared chip shell: fixed height, one border treatment, room for a trailing remove. */
const Chip = ({children, className}: {children: ReactNode; className?: string}) => (
    <div
        className={`flex ${TILE} items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-2 ${className ?? ""}`}
    >
        {children}
    </div>
)

interface ComposerAttachmentsProps {
    files: UploadFile[]
    rejections: AttachmentRejection[]
    limits: AttachmentLimits
    /** Add picked files through the caller's guardrails (`validateIncoming`). */
    onAdd: (incoming: File[]) => void
    onRemove: (uid: string) => void
    onDismissRejections: () => void
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
}: ComposerAttachmentsProps) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [previews, setPreviews] = useState<Record<string, string>>({})
    const atMax = files.length >= limits.maxCount
    const maxMb = Math.round(limits.maxBytes / 1024 / 1024)

    // Object URLs for image previews and audio playback, recreated when the list changes and
    // revoked on cleanup (the list is small, ≤ maxCount). Without revoking, removed files leak.
    useEffect(() => {
        const next: Record<string, string> = {}
        files.forEach((f) => {
            const file = f.originFileObj as File | undefined
            const type = file?.type || ""
            if (file && (type.startsWith("image/") || type.startsWith("audio/"))) {
                next[f.uid] = URL.createObjectURL(file)
            }
        })
        setPreviews(next)
        return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u))
    }, [files])

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
                    accept={limits.acceptAttr}
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
                            <div className="flex flex-col gap-1 rounded-md bg-[var(--ant-color-error-bg)] px-2.5 py-1.5">
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
                                    className="flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-0 py-0 text-[11px] text-colorError hover:underline"
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
                        <Text className="!text-xs !font-medium">Attach files</Text>
                        <Text type="secondary" className="!text-[11px]">
                            {limits.label} · up to {limits.maxCount}, {maxMb} MB each
                        </Text>
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
                                            className="shrink-0"
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
                                                    {/* Local object URL — next/image can't optimize a blob. */}
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={url}
                                                        alt={f.name}
                                                        className="h-full w-full object-cover"
                                                    />
                                                    <RemoveButton
                                                        name={f.name}
                                                        onRemove={remove}
                                                        overlay
                                                    />
                                                </div>
                                            ) : (
                                                <Chip className="max-w-[200px]">
                                                    <Icon
                                                        size={18}
                                                        className="shrink-0 text-colorTextSecondary"
                                                    />
                                                    <div className="flex min-w-0 flex-col">
                                                        <Text
                                                            className="!text-xs truncate"
                                                            title={f.name}
                                                        >
                                                            {f.name}
                                                        </Text>
                                                        {size && (
                                                            <Text
                                                                type="secondary"
                                                                className="!text-[11px]"
                                                            >
                                                                {size}
                                                            </Text>
                                                        )}
                                                    </div>
                                                    <RemoveButton name={f.name} onRemove={remove} />
                                                </Chip>
                                            )}
                                        </motion.div>
                                    )
                                })}
                            </AnimatePresence>

                            {!atMax && (
                                <motion.div layout className="shrink-0">
                                    <Tooltip title="Add more">
                                        <button
                                            type="button"
                                            onClick={pick}
                                            aria-label="Add more files"
                                            className={`flex ${TILE} w-12 cursor-pointer items-center justify-center rounded-lg border border-dashed border-colorBorder bg-transparent text-colorTextTertiary transition-colors hover:border-colorPrimary hover:bg-colorFillQuaternary hover:text-colorPrimary`}
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </Tooltip>
                                </motion.div>
                            )}
                        </div>

                        {/* Outside the scroller: the count must stay put rather than scroll away. */}
                        <span className="shrink-0 text-[11px] tabular-nums text-colorTextTertiary">
                            {files.length} / {limits.maxCount}
                        </span>
                    </div>
                )}
            </div>
        </MotionConfig>
    )
}

export default ComposerAttachments
