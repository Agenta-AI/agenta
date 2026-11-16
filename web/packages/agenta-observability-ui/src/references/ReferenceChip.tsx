import {useEffect, useRef, useState, type ComponentType, type MouseEvent} from "react"

import {useT} from "@agenta/i18n"
import referencesCatalog from "@agenta/i18n/catalogs/observabilityUi.references"
import {SkeletonBlock, HoverCard, HoverCardContent, HoverCardTrigger} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {
    ArrowSquareOut,
    Check,
    CloudArrowUp,
    Copy,
    Database,
    Gavel,
    GitCommit,
    SquaresFour,
    type IconProps,
} from "@phosphor-icons/react"
import clsx from "clsx"
import Link from "next/link"

export type ReferenceKind = "app" | "variant" | "testset" | "evaluator" | "environment"

/** What the hovercard lists under the name. */
export interface ReferenceIdentifiers {
    slug?: string | null
    id?: string | null
    version?: number | string | null
    revisionId?: string | null
}

export interface ReferenceChipProps {
    kind: ReferenceKind
    label: string
    href?: string | null
    /** Opens the link in a new tab. */
    openExternally?: boolean
    identifiers?: ReferenceIdentifiers
    /** The entity is gone: a muted, struck-through chip with no link. */
    deleted?: boolean
}

const KIND_META = {
    app: {labelKey: "observabilityUi.references.application", Icon: SquaresFour},
    variant: {labelKey: "observabilityUi.references.variant", Icon: GitCommit},
    testset: {labelKey: "observabilityUi.references.testSet", Icon: Database},
    evaluator: {labelKey: "observabilityUi.references.evaluator", Icon: Gavel},
    environment: {labelKey: "observabilityUi.references.environment", Icon: CloudArrowUp},
} as const satisfies Record<
    ReferenceKind,
    {
        labelKey:
            | "observabilityUi.references.application"
            | "observabilityUi.references.variant"
            | "observabilityUi.references.testSet"
            | "observabilityUi.references.evaluator"
            | "observabilityUi.references.environment"
        Icon: ComponentType<IconProps>
    }
>

// The per-kind tone variables from @agenta/ui/theme-variables.css, light and dark.
const toneStyle = (kind: ReferenceKind) => ({
    color: `var(--ag-ref-${kind}-text)`,
    backgroundColor: `var(--ag-ref-${kind}-bg)`,
    borderColor: `var(--ag-ref-${kind}-border)`,
})

const middleTruncate = (value: string) =>
    value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value

const CopyIconButton = ({value, title}: {value: string; title: string}) => {
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
            onClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                void copyToClipboard(value)
                setCopied(true)
                clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), 1500)
            }}
        >
            {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
    )
}

/** The loading stand-in for a chip, the same height as the chip. */
export const ReferenceChipSkeleton = () => <SkeletonBlock className="h-[22px] w-[140px]" />

/**
 * A linked reference: tone, entity icon, name, version and a link arrow. Hovering it shows the
 * identifiers with copy buttons.
 */
export const ReferenceChip = ({
    kind,
    label,
    href,
    openExternally = false,
    identifiers,
    deleted = false,
}: ReferenceChipProps) => {
    const t = useT(referencesCatalog)
    const {labelKey, Icon} = KIND_META[kind]
    const kindLabel = t(labelKey)
    const linked = Boolean(href) && !deleted
    const version = deleted ? null : (identifiers?.version ?? null)
    const rows = deleted
        ? []
        : [
              identifiers?.slug && identifiers.slug !== label
                  ? {
                        id: "slug",
                        name: t("observabilityUi.references.slug"),
                        value: identifiers.slug,
                        copy: identifiers.slug,
                    }
                  : null,
              identifiers?.id
                  ? {
                        id: "id",
                        name: t("observabilityUi.references.id"),
                        value: middleTruncate(identifiers.id),
                        copy: identifiers.id,
                    }
                  : null,
              version != null
                  ? {
                        id: "version",
                        name: t("observabilityUi.references.version"),
                        value: `v${version}`,
                        copy: String(version),
                    }
                  : null,
              identifiers?.revisionId
                  ? {
                        id: "revisionId",
                        name: t("observabilityUi.references.revisionId"),
                        value: middleTruncate(identifiers.revisionId),
                        copy: identifiers.revisionId,
                    }
                  : null,
          ].filter(
              (row): row is {id: string; name: string; value: string; copy: string} => row !== null,
          )

    const body = (
        <>
            <Icon size={12} className="shrink-0" />
            <span className={clsx("min-w-0 truncate", deleted && "line-through")}>{label}</span>
            {version != null ? (
                <span className="shrink-0 rounded-sm bg-colorBgContainer px-1 text-[11px] leading-4">
                    {/* A version tag ("v3"), the same in every language. */}
                    {`v${version}`}
                </span>
            ) : null}
            {linked ? <ArrowSquareOut size={12} className="shrink-0" /> : null}
        </>
    )
    const chipClass = clsx(
        "inline-flex h-[22px] max-w-[220px] items-center gap-1 rounded-md border border-solid px-1.5 text-xs no-underline",
        deleted && "border-colorBorder bg-colorFillTertiary text-colorTextTertiary",
        linked && "cursor-pointer hover:brightness-95",
    )
    const style = deleted ? undefined : toneStyle(kind)
    const chip = linked ? (
        <Link
            href={href as string}
            prefetch={false}
            className={chipClass}
            style={style}
            target={openExternally ? "_blank" : undefined}
            rel={openExternally ? "noreferrer" : undefined}
            onClick={(event: MouseEvent) => event.stopPropagation()}
        >
            {body}
        </Link>
    ) : (
        <span className={chipClass} style={style}>
            {body}
        </span>
    )

    if (deleted || rows.length === 0) return chip

    return (
        <HoverCard openDelay={300} closeDelay={100}>
            <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
            <HoverCardContent align="end" className="w-[300px] p-0">
                <div className="flex items-start gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2.5">
                    <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-solid"
                        style={toneStyle(kind)}
                    >
                        <Icon size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-colorTextTertiary">
                            {kindLabel}
                        </div>
                        <div className="break-words text-xs font-medium text-colorText">
                            {label}
                        </div>
                    </div>
                    <CopyIconButton
                        value={label}
                        title={t("observabilityUi.references.copyName")}
                    />
                </div>
                <div className="flex flex-col px-3 pb-2 pt-1.5">
                    {rows.map((row) => (
                        <div key={row.id} className="flex min-h-6 items-center gap-2 py-1">
                            <span className="w-[76px] shrink-0 text-xs text-colorTextTertiary">
                                {row.name}
                            </span>
                            <span
                                title={row.copy}
                                className="min-w-0 flex-1 truncate font-mono text-xs text-colorTextSecondary"
                            >
                                {row.value}
                            </span>
                            <CopyIconButton
                                value={row.copy}
                                title={t("observabilityUi.references.copyField", {name: row.name})}
                            />
                        </div>
                    ))}
                </div>
            </HoverCardContent>
        </HoverCard>
    )
}
