import {useEffect, useRef, useState, type ComponentType, type ReactNode} from "react"

import {
    ArrowSquareOut,
    BracketsCurly,
    Check,
    CloudArrowUp,
    Copy,
    Database,
    Gavel,
    GitCommit,
    MagnifyingGlass,
    SquaresFour,
    type IconProps,
} from "@phosphor-icons/react"
import {Popover, Tag, type TagProps, Tooltip} from "antd"
import type {TooltipPlacement} from "antd/es/tooltip"
import clsx from "clsx"
import {useRouter} from "next/router"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import {getReferenceToneColors, type ReferenceTone} from "./referenceColors"

/**
 * Identifier set behind a reference chip. Feeds the slug crossfade on hover,
 * the version pill, and the identifier hovercard.
 */
export interface ReferenceIdentifiers {
    name?: string | null
    slug?: string | null
    id?: string | null
    version?: number | string | null
    revisionId?: string | null
}

interface ReferenceTagProps extends TagProps {
    label: string
    href?: string
    /** Legacy alias of `showLinkIcon` (kept until call sites migrate). */
    showIcon?: boolean
    iconColor?: string
    /** Legacy tooltip; only shown when the hovercard is inactive. */
    tooltip?: string
    /** Legacy label-click copy; only active when the hovercard is inactive. */
    copyValue?: string
    tone?: ReferenceTone
    openExternally?: boolean
    /** Drives the entity icon + hovercard kind label; defaults to `tone`. */
    entityKind?: ReferenceTone
    /** Feeds slug crossfade, version pill, and the hovercard rows. */
    identifiers?: ReferenceIdentifiers
    /** Render the link arrow when an href exists (default true). */
    showLinkIcon?: boolean
    /** Identifier hovercard (default true when identifiers exist). */
    hovercard?: boolean
    hovercardPlacement?: TooltipPlacement
    /** Deleted entity: muted chip, struck-through name, no icon/arrow/hovercard. */
    deleted?: boolean
}

const ENTITY_KIND_META: Record<
    ReferenceTone,
    {label: string; Icon: ComponentType<IconProps>; iconWeight?: IconProps["weight"]}
> = {
    app: {label: "Application", Icon: SquaresFour},
    variant: {label: "Variant", Icon: GitCommit},
    testset: {label: "Test set", Icon: Database},
    query: {label: "Query", Icon: MagnifyingGlass},
    evaluator: {label: "Evaluator", Icon: Gavel},
    environment: {label: "Environment", Icon: CloudArrowUp},
}

export const middleTruncateId = (value: string) =>
    value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value

const buildReferenceJson = (kind: ReferenceTone | undefined, ids: ReferenceIdentifiers) => {
    if (kind === "variant") {
        const json: Record<string, unknown> = {
            variant_ref: {
                id: ids.id ?? null,
                slug: ids.slug ?? null,
                version: ids.version ?? null,
            },
        }
        if (ids.revisionId) {
            json.revision_ref = {id: ids.revisionId, version: ids.version ?? null}
        }
        return json
    }
    const json: Record<string, unknown> = {id: ids.id ?? null}
    if (ids.slug) json.slug = ids.slug
    if (ids.version != null) json.version = ids.version
    return json
}

const COPY_RESET_MS = 1500

/** 20×20 copy button: Copy → Check (green) for 1.5s. */
export const CopyIconButton = ({value, title}: {value: string; title: string}) => {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])

    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            className={clsx(
                "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0",
                copied
                    ? "text-colorSuccess"
                    : "text-colorTextTertiary hover:bg-colorFillSecondary hover:text-colorText",
            )}
            onClick={(e) => {
                e.stopPropagation()
                void copyToClipboard(value)
                setCopied(true)
                clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), COPY_RESET_MS)
            }}
        >
            {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
    )
}

const ReferenceHovercard = ({
    kind,
    name,
    identifiers,
    linked,
    onOpenLink,
}: {
    kind: ReferenceTone
    name: string
    identifiers: ReferenceIdentifiers
    linked: boolean
    onOpenLink: () => void
}) => {
    const meta = ENTITY_KIND_META[kind]
    const toneColors = getReferenceToneColors(kind)
    const [jsonCopied, setJsonCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])

    const rows: {label: string; value: ReactNode; copy: string; mono: boolean}[] = []
    if (identifiers.slug) {
        rows.push({label: "Slug", value: identifiers.slug, copy: identifiers.slug, mono: true})
    }
    if (identifiers.id) {
        rows.push({
            label: "ID",
            value: middleTruncateId(identifiers.id),
            copy: identifiers.id,
            mono: true,
        })
    }
    if (identifiers.version != null) {
        rows.push({
            label: "Version",
            value: `v${identifiers.version}`,
            copy: String(identifiers.version),
            mono: false,
        })
    }
    if (identifiers.revisionId) {
        rows.push({
            label: "Revision ID",
            value: middleTruncateId(identifiers.revisionId),
            copy: identifiers.revisionId,
            mono: true,
        })
    }

    return (
        <div className="w-[320px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2.5">
                <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-solid"
                    style={
                        toneColors
                            ? {
                                  backgroundColor: toneColors.background,
                                  borderColor: toneColors.border,
                                  color: toneColors.text,
                              }
                            : undefined
                    }
                >
                    <meta.Icon size={13} weight={meta.iconWeight} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-colorTextTertiary">
                        {meta.label}
                    </div>
                    <div className="break-words text-[12.5px] font-medium leading-[1.4] text-colorText">
                        {name}
                    </div>
                </div>
                <CopyIconButton value={name} title="Copy name" />
            </div>

            {rows.length ? (
                <div className="flex flex-col px-3 pb-2 pt-1.5">
                    {rows.map((row) => (
                        <div key={row.label} className="flex min-h-6 items-center gap-2 py-1">
                            <span className="w-[76px] shrink-0 text-[11px] text-colorTextTertiary">
                                {row.label}
                            </span>
                            <span
                                title={row.copy}
                                className={clsx(
                                    "min-w-0 flex-1 truncate",
                                    row.mono
                                        ? "font-mono text-[11px] text-colorTextSecondary"
                                        : "text-[11.5px] text-colorText",
                                )}
                            >
                                {row.value}
                            </span>
                            <CopyIconButton
                                value={row.copy}
                                title={`Copy ${row.label.toLowerCase()}`}
                            />
                        </div>
                    ))}
                </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 rounded-b-lg border-0 border-t border-solid border-colorBorderSecondary bg-zinc-1 px-3 py-[7px]">
                <button
                    type="button"
                    className="flex cursor-pointer items-center gap-[5px] rounded border-0 bg-transparent px-1.5 py-[3px] text-[11.5px] text-colorTextSecondary hover:bg-colorFillSecondary hover:text-colorText"
                    onClick={() => {
                        void copyToClipboard(
                            JSON.stringify(buildReferenceJson(kind, identifiers), null, 2),
                        )
                        setJsonCopied(true)
                        clearTimeout(timer.current)
                        timer.current = setTimeout(() => setJsonCopied(false), COPY_RESET_MS)
                    }}
                >
                    {jsonCopied ? <Check size={12} /> : <BracketsCurly size={12} />}
                    {jsonCopied ? "Copied" : "Copy reference JSON"}
                </button>
                {linked ? (
                    <button
                        type="button"
                        className="flex cursor-pointer items-center gap-[5px] rounded border-0 bg-transparent px-1.5 py-[3px] text-[11.5px] text-colorTextSecondary hover:bg-colorFillSecondary hover:text-colorText"
                        onClick={onOpenLink}
                    >
                        <ArrowSquareOut size={12} />
                        Open
                    </button>
                ) : null}
            </div>
        </div>
    )
}

const ReferenceTag = ({
    label,
    href,
    showIcon,
    iconColor,
    className,
    tooltip,
    copyValue,
    tone,
    openExternally = false,
    entityKind,
    identifiers,
    showLinkIcon,
    hovercard = true,
    hovercardPlacement,
    deleted = false,
    ...props
}: ReferenceTagProps) => {
    const router = useRouter()
    const [cardOpen, setCardOpen] = useState(false)

    const kind = entityKind ?? tone
    const kindMeta = kind ? ENTITY_KIND_META[kind] : null
    const toneColors = deleted ? null : getReferenceToneColors(tone)

    const isClickable = Boolean(href) && !deleted
    const showArrow = (showLinkIcon ?? showIcon ?? true) && isClickable
    const hovercardActive =
        hovercard &&
        !deleted &&
        Boolean(kind) &&
        Boolean(
            identifiers &&
            (identifiers.id ||
                identifiers.slug ||
                identifiers.revisionId ||
                identifiers.version != null),
        )
    const version = deleted ? null : (identifiers?.version ?? null)
    const hovercardName = identifiers?.name ?? label

    // Close the hovercard on Esc.
    useEffect(() => {
        if (!cardOpen) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setCardOpen(false)
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [cardOpen])

    const navigate = () => {
        if (!href) return
        if (openExternally) {
            window.open(href, "_blank", "noreferrer")
        } else {
            void router.push(href)
        }
    }

    // The chip always shows the human-readable name. Slug, ID, version, and
    // revision ID stay available in the hovercard — we intentionally do NOT
    // swap the visible name for the slug on hover. The previous crossfade made
    // chips appear to "turn into" an opaque ID/hex slug while hovered (#4712).
    const nameNode = (
        <span
            className={clsx(
                "min-w-0 truncate",
                deleted ? "font-normal line-through" : "font-medium",
                !hovercardActive && copyValue && "cursor-copy",
            )}
            onClick={
                !hovercardActive && copyValue
                    ? (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void copyToClipboard(copyValue)
                      }
                    : undefined
            }
        >
            {label}
        </span>
    )

    const tagNode = (
        <Tag
            variant="filled"
            tabIndex={hovercardActive ? 0 : undefined}
            className={clsx(
                // leading-5 (not leading-none): the truncating spans clip overflow, so the
                // line box must be tall enough for descenders; h-6 + items-center fixes the
                // chip height independently of the text line height.
                // group/refchip (named) so hovering an ancestor `.group` row never
                // reveals the chip's link arrow — only hovering the chip itself does.
                // w-fit: some containers force `.ant-tag` to display:flex (e.g. the
                // trace drawer's `[&_.ant-tag]:flex`), which would stretch the chip
                // to its max-width and leave dead space after the content.
                "group/refchip inline-flex h-6 w-fit items-center gap-1.5 whitespace-nowrap rounded border border-solid px-2 text-xs leading-5 transition-[filter,background-color]",
                !className?.includes("max-w") && "max-w-[320px]",
                deleted &&
                    "border-colorBorderSecondary bg-zinc-1 text-colorTextTertiary hover:brightness-100",
                !deleted && toneColors && "hover:brightness-[0.97]",
                !deleted &&
                    !toneColors &&
                    "border-transparent bg-[var(--ag-c-0517290F)] text-[var(--ag-c-344054)] hover:bg-[var(--ag-c-05172916)]",
                className,
            )}
            style={
                toneColors
                    ? {
                          backgroundColor: toneColors.background,
                          borderColor: toneColors.border,
                          color: toneColors.text,
                      }
                    : undefined
            }
            {...props}
        >
            {kindMeta && !deleted ? (
                <kindMeta.Icon size={13} weight={kindMeta.iconWeight} className="shrink-0" />
            ) : null}
            {nameNode}
            {version != null ? (
                <span className="shrink-0 rounded-[3px] bg-white/70 px-[5px] py-px font-mono text-[10.5px] leading-[14px] dark:bg-white/10">
                    v{version}
                </span>
            ) : null}
            {showArrow ? (
                <ArrowSquareOut
                    role="button"
                    aria-label="Open link"
                    size={13}
                    className="shrink-0 cursor-pointer opacity-[0.55] transition-opacity duration-150 group-hover/refchip:opacity-100"
                    style={{color: iconColor ?? toneColors?.text ?? "currentColor"}}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigate()
                    }}
                />
            ) : null}
        </Tag>
    )

    if (hovercardActive && kind) {
        return (
            <Popover
                open={cardOpen}
                onOpenChange={setCardOpen}
                trigger={["hover", "focus"]}
                mouseEnterDelay={0.15}
                mouseLeaveDelay={0.18}
                placement={hovercardPlacement ?? "bottomLeft"}
                arrow={false}
                styles={{container: {padding: 0}}}
                content={
                    <ReferenceHovercard
                        kind={kind}
                        name={hovercardName}
                        identifiers={identifiers ?? {}}
                        linked={isClickable}
                        onOpenLink={() => {
                            setCardOpen(false)
                            navigate()
                        }}
                    />
                }
            >
                {tagNode}
            </Popover>
        )
    }

    if (!tooltip) {
        return tagNode
    }

    return (
        <Tooltip title={tooltip} mouseEnterDelay={0.2}>
            {tagNode}
        </Tooltip>
    )
}

export default ReferenceTag
