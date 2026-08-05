/**
 * Tag — the single tag component to reach for.
 *
 * Generic (`tone` + `label` + `icon` + `size`) with **domain presets** that carry the
 * value→tone/label knowledge so callers don't juggle a separate component per domain:
 *
 * ```tsx
 * <Tag tone="warning">Loading…</Tag>     // generic
 * <Tag status="running" />               // was StatusTag
 * <Tag mapping="auto" showIcon />        // was MappingStatusTag
 * <Tag env="production" />               // was EnvironmentTag
 * <Tag draft />                          // was DraftTag
 * <Tag sync="modified" dismissible onDismiss={…} /> // was SyncStateTag
 * ```
 *
 * Renders the `@agenta/ui` `Badge` (antd-Tag geometry, palette-driven colors → light/dark
 * safe). Types come from their canonical homes; this module owns only the tone/label maps.
 */

import {memo, type CSSProperties, type ReactNode} from "react"

import {type MappingStatus, getMappingStatusConfig} from "@agenta/shared/utils"
import {MagicWand, PencilSimpleLine, Warning, X} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"
import {Badge, type BadgeProps} from "../../ui/badge"
import {type EnvironmentName, type ExecutionStatus, type QueryStatus} from "../status"

type Tone = BadgeProps["variant"]

/** Testcase sync state (was `SyncStateTag`'s `SyncState`; `Tag` now owns it). */
export type SyncState = "unmodified" | "modified" | "new" | "hidden"

// ── Preset tone/label maps (the single home for tag colour knowledge) ────────
const STATUS: Record<QueryStatus | ExecutionStatus, {tone: Tone; label: string}> = {
    loading: {tone: "warning", label: "Loading..."},
    pending: {tone: "warning", label: "Pending"},
    running: {tone: "processing", label: "Running..."},
    error: {tone: "error", label: "Error"},
    success: {tone: "success", label: "Success"},
    ready: {tone: "success", label: "Ready"},
    idle: {tone: "default", label: "Idle"},
}

const SYNC: Partial<Record<SyncState, {tone: Tone; label: string}>> = {
    modified: {tone: "blue", label: "Edited"},
    new: {tone: "green", label: "New"},
}

const ENV_LABEL: Record<EnvironmentName, string> = {
    production: "Production",
    staging: "Staging",
    development: "Development",
}

function mappingTone(status: MappingStatus): Tone {
    switch (status) {
        case "auto":
            return "blue"
        case "manual":
            return "green"
        case "missing":
        case "invalid_path":
            return "red"
        case "type_mismatch":
            return "orange"
        default:
            return "default"
    }
}

function mappingIcon(status: MappingStatus, size: number): ReactNode {
    switch (status) {
        case "auto":
            return <MagicWand size={size} />
        case "missing":
        case "invalid_path":
        case "type_mismatch":
            return <Warning size={size} />
        default:
            return null
    }
}

export interface TagProps extends Omit<BadgeProps, "variant" | "icon" | "children"> {
    /** Generic semantic tone (→ a Badge variant). Ignored when a preset prop is set. */
    tone?: Tone
    /** Visible label (overrides a preset's default label). */
    label?: ReactNode
    /** Leading icon. */
    icon?: ReactNode
    /** @default "default" */
    size?: "small" | "default"
    /** Preset: query/execution status → tone + default label. */
    status?: QueryStatus | ExecutionStatus
    /** Preset: field-mapping status → tone + label (+ icon via `showIcon`). */
    mapping?: MappingStatus
    /** Preset: deployment environment → env colours + label. */
    env?: string
    /** Preset: a "Draft" marker (pencil icon unless `showIcon={false}`). */
    draft?: boolean
    /** Preset: testcase sync state ("modified"/"new" render; others render nothing). */
    sync?: SyncState
    /** Show the preset icon (mapping / draft). */
    showIcon?: boolean
    /** Sync "modified": show a dismiss (×). */
    dismissible?: boolean
    onDismiss?: () => void
    children?: ReactNode
}

// Canonical "small" geometry (was duplicated & divergent across the old facades).
const SMALL = "text-xs py-0"

function TagImpl({
    tone,
    label,
    icon,
    size = "default",
    status,
    mapping,
    env,
    draft,
    sync,
    showIcon,
    dismissible,
    onDismiss,
    className,
    onClick,
    children,
    ...rest
}: TagProps) {
    const iconSize = size === "small" ? 10 : 12
    let variant = tone
    let content: ReactNode = label ?? children
    let leadingIcon = icon
    let style: CSSProperties | undefined

    if (status != null) {
        variant = STATUS[status]?.tone ?? "default"
        content = label ?? STATUS[status]?.label ?? status
    } else if (mapping != null) {
        variant = mappingTone(mapping)
        content = label ?? getMappingStatusConfig(mapping).label
        leadingIcon = showIcon ? mappingIcon(mapping, iconSize) : leadingIcon
    } else if (env != null) {
        const name = env.toLowerCase() as EnvironmentName
        const known = ENV_LABEL[name]
        content = label ?? known ?? env ?? "Unknown"
        if (known)
            style = {
                backgroundColor: `var(--ag-env-${name}-bg)`,
                color: `var(--ag-env-${name}-text)`,
                borderColor: `var(--ag-env-${name}-border)`,
            }
    } else if (draft) {
        variant = "draft"
        content = label ?? "Draft"
        leadingIcon = showIcon === false ? undefined : (icon ?? <PencilSimpleLine size={14} />)
    } else if (sync != null) {
        const cfg = SYNC[sync]
        if (!cfg) return null
        variant = cfg.tone
        content = label ?? cfg.label
    }

    const showDismiss = Boolean(dismissible && sync === "modified" && onDismiss)

    return (
        <Badge
            variant={variant}
            icon={leadingIcon}
            onClick={onClick}
            style={style}
            className={cn(
                size === "small" && SMALL,
                (onClick || showDismiss) && "cursor-pointer",
                showDismiss && "group select-none",
                "w-fit",
                className,
            )}
            {...rest}
        >
            {content}
            {showDismiss ? (
                // antd's close-icon slot: 3px inset (Badge's own gap-1 is 4px) and colorIcon grey.
                <span
                    title="Discard changes"
                    className="-ml-px inline-flex cursor-pointer text-colorIcon"
                    onClick={onDismiss}
                >
                    <X size={12} />
                </span>
            ) : null}
        </Badge>
    )
}

export const Tag = memo(TagImpl)

export default Tag
