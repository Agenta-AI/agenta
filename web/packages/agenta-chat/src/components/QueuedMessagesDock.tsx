/**
 * The docked message queue — what you have lined up, pinned above the composer.
 *
 * Sibling of `ApprovalDock` / `ElicitationDock` / `ConnectionDock` in form, but not in kind: those
 * are gates the run is blocked on, this is a list the run will drain on its own. It therefore keeps
 * its place ABOVE them, so the gate that actually wants an answer stays nearest the input.
 *
 * Two properties are the point:
 *
 *  - **The card never grows without bound.** The header is pinned and only the body scrolls, so a
 *    twelve-deep queue takes exactly as much room as a five-deep one, and the count and collapse
 *    toggle stay reachable at any length.
 *  - **Editing happens in the composer, not here.** A row's pencil hands its text to the host, which
 *    loads it into the input; this card only MARKS which row is under edit and offers the way out.
 *    See `useAgentChatQueue.commitEdit` for what the resulting send does.
 */
import {memo, useEffect, useRef, useState} from "react"

import {getCollapseLabel} from "@agenta/ui/components/presentational"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {Button} from "@agenta/ui/ui"
import {
    CaretUp,
    File as FileIcon,
    PencilSimple,
    SpeakerHigh,
    Stack,
    Trash,
    VideoCamera,
} from "@phosphor-icons/react"
import type {FileUIPart} from "ai"

import {fileKind, filePartName} from "../assets/files"
import type {QueuedMessage} from "../hooks/useAgentChatQueue"

/** The dock family's surface — same geometry as the approval and connect cards. */
const CARD_SURFACE =
    "rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer shadow-sm"

/** Five rows at the design's 32px row height. Past that the body scrolls; the card does not grow. */
const BODY_MAX_H = "max-h-40"

/** Shared tile chrome, so the count block and the type icon read as the same object. */
const TILE =
    "inline-flex size-5 shrink-0 items-center justify-center rounded border border-solid border-colorBorderSecondary"

/** One attachment tile: image thumbnail, else a type icon. Sized to sit inside a 32px row. */
const Attachment = ({part}: {part: FileUIPart}) => {
    const name = filePartName(part)
    const kind = fileKind(part.mediaType)
    if (kind === "image") {
        return (
            // A data: or blob: thumbnail — next/image can optimize neither.
            <img src={part.url} alt={name} title={name} className={`${TILE} object-cover`} />
        )
    }
    const Icon = kind === "audio" ? SpeakerHigh : kind === "video" ? VideoCamera : FileIcon
    return (
        <span
            role="img"
            aria-label={name}
            title={name}
            className={`${TILE} bg-colorFillTertiary text-colorTextSecondary`}
        >
            <Icon size={11} aria-hidden />
        </span>
    )
}

/**
 * A message's files, leading the row. One file shows its own tile; several collapse into a single
 * counted block rather than a strip, so the row keeps its height and the text keeps its width no
 * matter how many files a message carries.
 */
const Attachments = ({files}: {files: FileUIPart[]}) => {
    if (files.length === 1) return <Attachment part={files[0]} />
    const label = `${files.length} attachments`
    return (
        <span
            role="img"
            aria-label={label}
            title={files.map(filePartName).join(", ")}
            className={`${TILE} bg-colorFillTertiary text-[10px] font-medium tabular-nums text-colorTextSecondary`}
        >
            {files.length}
        </span>
    )
}

const Row = ({
    message,
    editing,
    touchCls,
    onEdit,
    onCancelEdit,
    onRemove,
}: {
    message: QueuedMessage
    editing: boolean
    touchCls: string
    onEdit?: (message: QueuedMessage) => void
    onCancelEdit?: () => void
    onRemove: (id: string) => void
}) => {
    const text = message.text.trim()
    const files = message.fileParts ?? []
    return (
        <div
            className={`group flex min-h-8 items-center gap-1.5 rounded-lg px-2 transition-colors ${
                editing ? "bg-colorFillTertiary" : "hover:bg-colorFillTertiary"
            }`}
        >
            {files.length > 0 && <Attachments files={files} />}
            {text ? (
                <span title={text} className="min-w-0 flex-1 truncate text-xs text-colorText">
                    {text}
                </span>
            ) : (
                <span className="min-w-0 flex-1 truncate text-xs italic text-colorTextTertiary">
                    {files.length ? "(attachments only)" : "(empty message)"}
                </span>
            )}
            {/* Revealed on hover, but always present for keyboard and while this row is under
                edit — an action you can only reach with a pointer is not an action on mobile. */}
            <span
                className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                    editing
                        ? "opacity-100"
                        : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                }`}
            >
                {editing ? (
                    <Button
                        size="sm"
                        variant="ghost"
                        className={`h-6 !text-xs text-colorTextSecondary ${touchCls}`}
                        onClick={onCancelEdit}
                    >
                        Cancel
                    </Button>
                ) : onEdit ? (
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit queued message"
                        className={`size-6 text-colorTextTertiary hover:text-colorText ${touchCls}`}
                        onClick={() => onEdit(message)}
                    >
                        <PencilSimple size={13} />
                    </Button>
                ) : null}
                <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove queued message"
                    className={`size-6 text-colorTextTertiary hover:text-colorText ${touchCls}`}
                    onClick={() => onRemove(message.id)}
                >
                    <Trash size={13} />
                </Button>
            </span>
        </div>
    )
}

export interface QueuedMessagesDockProps {
    /** Held messages in FIFO order — index 0 is released first. */
    queued: QueuedMessage[]
    /** The run is parked on the user (HITL), so the queue is held rather than merely waiting. */
    held?: boolean
    onRemove: (id: string) => void
    /** Hand a row's content to the host's composer. Omit on surfaces without an editable input. */
    onEdit?: (message: QueuedMessage) => void
    /** Abandon the edit; the host puts the stashed draft back. */
    onCancelEdit?: () => void
    /** Id of the row the composer is currently editing. */
    editingId?: string | null
    /** Invisibly extended tap area; the chrome stays identical. */
    touch?: boolean
    className?: string
}

const QueuedMessagesDock = ({
    queued,
    held = false,
    onRemove,
    onEdit,
    onCancelEdit,
    editingId = null,
    touch = false,
    className = "",
}: QueuedMessagesDockProps) => {
    const [collapsed, setCollapsed] = useState(false)
    const bodyRef = useRef<HTMLDivElement>(null)
    const countRef = useRef(queued.length)

    // Messages append at the tail, so past the scroll cap a new one lands out of sight and Enter
    // looks like it did nothing. Follow the tail on growth only — never on a removal, which would
    // yank the list under the pointer that just removed something.
    useEffect(() => {
        const grew = queued.length > countRef.current
        countRef.current = queued.length
        if (!grew || collapsed) return
        const body = bodyRef.current
        if (body) body.scrollTop = body.scrollHeight
    }, [queued.length, collapsed])

    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

    return (
        <div className={`${CARD_SURFACE} ${className}`}>
            {/* px-3 so the icon starts on the same 13px line as the row text below it and the
                composer's own text — the card reads as one left edge, not three. */}
            <div className="flex items-center gap-2 px-3 py-1.5">
                <Stack size={14} className="shrink-0 text-colorTextTertiary" aria-hidden />
                <span className="min-w-0 truncate text-[13px] text-colorTextSecondary">
                    {queued.length} queued message{queued.length === 1 ? "" : "s"}
                    {held ? " · waits for your answer" : ""}
                </span>
                <span className="flex-1" />
                {/* Not `CollapseToggleButton`: it carries a tooltip, and a caret in a two-item
                    header does not need explaining. Its label helper still applies. */}
                <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={getCollapseLabel(collapsed)}
                    className={`text-colorTextTertiary hover:text-colorText ${touchCls}`}
                    onClick={() => setCollapsed((c) => !c)}
                >
                    <CaretUp
                        size={12}
                        className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
                            collapsed ? "rotate-180" : ""
                        }`}
                    />
                </Button>
            </div>
            {/* The composer sits directly below, so a hard mount/unmount teleports it by the
                body's full height. `HeightCollapse` is the app's one collapse primitive — the same
                motion as the accordion sections and the sibling docks — and it owns aria-hidden
                + inert while shut, so the rows are unreachable when they are not visible. */}
            <HeightCollapse open={!collapsed} durationMs={200} fade>
                <div ref={bodyRef} className={`${BODY_MAX_H} overflow-y-auto px-1 pb-1`}>
                    {queued.map((message) => (
                        <Row
                            key={message.id}
                            message={message}
                            editing={message.id === editingId}
                            touchCls={touchCls}
                            onEdit={onEdit}
                            onCancelEdit={onCancelEdit}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            </HeightCollapse>
        </div>
    )
}

export default memo(QueuedMessagesDock)
