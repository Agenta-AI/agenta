import {useEffect, useRef, useState} from "react"

import {
    File as FileIcon,
    FileText,
    Image as ImageIcon,
    Pause,
    Play,
    Plus,
    UploadSimple,
    WarningCircle,
    X,
} from "@phosphor-icons/react"
import {Tooltip, Typography} from "antd"
import type {UploadFile} from "antd"

import {type AttachmentLimits, type AttachmentRejection, formatBytes} from "../assets/attachments"

const {Text} = Typography

const iconForType = (mediaType: string) => {
    if (mediaType.startsWith("image/")) return ImageIcon
    if (mediaType === "application/pdf" || mediaType.startsWith("text/")) return FileText
    return FileIcon
}

const fmtTime = (s: number): string => {
    if (!isFinite(s)) return "0:00"
    const t = Math.floor(s)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

/** A recorded/attached audio clip: play-pause with an elapsed readout, previewable before send. */
const AudioChip = ({url, name, onRemove}: {url: string; name: string; onRemove: () => void}) => {
    const ref = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)
    const [cur, setCur] = useState(0)
    const [dur, setDur] = useState(0)
    const toggle = () => {
        const a = ref.current
        if (!a) return
        if (a.paused) a.play().catch(() => {})
        else a.pause()
    }
    return (
        <div className="flex max-w-[220px] items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary px-2 py-1.5">
            <button
                type="button"
                onClick={toggle}
                aria-label={playing ? `Pause ${name}` : `Play ${name}`}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorFillTertiary text-colorText transition-colors hover:bg-colorFillSecondary"
            >
                {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            <div className="flex min-w-0 flex-col">
                <Text className="!text-xs truncate" title={name}>
                    {name}
                </Text>
                <Text type="secondary" className="!text-[11px] tabular-nums">
                    {fmtTime(cur)}
                    {isFinite(dur) && dur > 0 ? ` / ${fmtTime(dur)}` : ""}
                </Text>
            </div>
            <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={onRemove}
                className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorFillTertiary text-colorTextSecondary transition-colors hover:bg-colorFillSecondary"
            >
                <X size={10} />
            </button>
            <audio
                ref={ref}
                src={url}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                className="hidden"
            />
        </div>
    )
}

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
 * The composer's attachment panel: a borderless click/drop dropzone when empty, a compact row
 * of thumbnails (48px image previews) and file chips when filled, plus inline rejection messages
 * and a counter. Custom (not antd X `Attachments`) so the thumbnails stay small, the surface has
 * no nested border, and multi-select / multi-drop work. Drag-and-drop onto the whole panel is
 * owned by the parent; this renders the click path and the file list.
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

    // Object URLs for image previews, recreated when the list changes and revoked on cleanup
    // (the list is small, ≤ maxCount). Without revoking, removed images would leak their blobs.
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

    const pick = () => inputRef.current?.click()
    const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files
        if (list && list.length) onAdd(Array.from(list))
        e.target.value = "" // let the same file be re-picked after a remove
    }

    return (
        <div className="flex flex-col gap-2 p-2">
            <input
                ref={inputRef}
                type="file"
                multiple
                accept={limits.acceptAttr}
                onChange={onInput}
                className="hidden"
            />

            {rejections.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md bg-[var(--ant-color-error-bg)] px-2.5 py-1.5">
                    {rejections.map((r) => (
                        <div
                            key={`${r.name}-${r.reason}`}
                            className="flex items-center gap-1.5 text-xs text-colorError"
                        >
                            <WarningCircle size={13} weight="fill" className="shrink-0" />
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
            )}

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
                <div className="flex flex-wrap items-center gap-2">
                    {files.map((f) => {
                        const file = f.originFileObj as File | undefined
                        const type = file?.type || ""
                        const Icon = iconForType(type)
                        const size = file ? formatBytes(file.size) : ""
                        const url = previews[f.uid]
                        if (type.startsWith("audio/") && url) {
                            return (
                                <AudioChip
                                    key={f.uid}
                                    url={url}
                                    name={f.name}
                                    onRemove={() => onRemove(f.uid)}
                                />
                            )
                        }
                        return url ? (
                            <div
                                key={f.uid}
                                className="relative h-12 w-12 overflow-hidden rounded-lg border border-solid border-colorBorderSecondary"
                            >
                                {/* Local object URL — next/image can't optimize a blob. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={url}
                                    alt={f.name}
                                    className="h-full w-full object-cover"
                                />
                                <button
                                    type="button"
                                    aria-label={`Remove ${f.name}`}
                                    onClick={() => onRemove(f.uid)}
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.55)] text-white"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ) : (
                            <div
                                key={f.uid}
                                className="flex max-w-[180px] items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary px-2 py-1.5"
                            >
                                <Icon size={16} className="shrink-0 text-colorTextSecondary" />
                                <div className="flex min-w-0 flex-col">
                                    <Text className="!text-xs truncate" title={f.name}>
                                        {f.name}
                                    </Text>
                                    {size && (
                                        <Text type="secondary" className="!text-[11px]">
                                            {size}
                                        </Text>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    aria-label={`Remove ${f.name}`}
                                    onClick={() => onRemove(f.uid)}
                                    className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorFillTertiary text-colorTextSecondary transition-colors hover:bg-colorFillSecondary"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        )
                    })}
                    {!atMax && (
                        <Tooltip title="Add more">
                            <button
                                type="button"
                                onClick={pick}
                                aria-label="Add more files"
                                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg border border-dashed border-colorBorder bg-transparent text-colorTextTertiary transition-colors hover:bg-colorFillQuaternary"
                            >
                                <Plus size={16} />
                            </button>
                        </Tooltip>
                    )}
                    <span className="ml-auto text-[11px] text-colorTextTertiary">
                        {files.length} / {limits.maxCount}
                    </span>
                </div>
            )}
        </div>
    )
}

export default ComposerAttachments
