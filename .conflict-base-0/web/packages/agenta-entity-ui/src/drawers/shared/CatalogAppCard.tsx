/**
 * Catalog app card + logo — the provider tile shared by every Composio catalog grid (the
 * subscription "Choose a trigger" chooser AND the tools "Third-party integration" catalog), so
 * the app grid looks identical across triggers and tools. Dark-safe (`--ag-color*` tokens).
 */
import {EntityCard} from "@agenta/ui"
import {Lightning, Plugs} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import Image from "next/image"

// Composio returns lowercase category slugs ("crm", "ai agents"); these must stay all-caps.
const CATEGORY_ACRONYMS = new Set([
    "ai",
    "crm",
    "api",
    "hr",
    "it",
    "seo",
    "cms",
    "sms",
    "erp",
    "saas",
    "b2b",
    "b2c",
    "ui",
    "ux",
    "qa",
    "voip",
    "iot",
    "sql",
    "pos",
    "ats",
])

/** Title-case a lowercase catalog category, keeping known acronyms uppercase ("crm" → "CRM"). */
function formatCategoryLabel(raw: string): string {
    return raw
        .split(/\s+/)
        .map((word) =>
            CATEGORY_ACRONYMS.has(word.toLowerCase())
                ? word.toUpperCase()
                : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(" ")
}

/** An app's logo (catalog `integration.logo`), with a neutral plug fallback. */
export function AppLogo({logo, size = 20}: {logo?: string | null; size?: number}) {
    if (!logo) return <Plugs size={size} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
    return (
        <Image
            src={logo}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="shrink-0 rounded object-contain"
        />
    )
}

export function AppCard({
    logo,
    name,
    description,
    categories,
    actionsCount,
    connected,
    pending,
    onClick,
    variant = "bordered",
}: {
    logo?: string | null
    name: string
    description?: string | null
    categories?: string[]
    actionsCount?: number | null
    /** An active (functional) connection exists — green dot. */
    connected?: boolean
    /** A connection exists but none is active yet (auth pending/dropped) — amber dot. */
    pending?: boolean
    onClick: () => void
    /** "subtle" drops the rest border for a fill-based tile (agent playground catalog). */
    variant?: "bordered" | "subtle"
}) {
    const shownCategories = (categories ?? []).filter(Boolean).slice(0, 2).map(formatCategoryLabel)
    return (
        <EntityCard
            variant={variant}
            onClick={onClick}
            icon={<AppLogo logo={logo} size={28} />}
            title={name}
            titleAdornment={
                connected ? (
                    <Tooltip title="Connected">
                        <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                    </Tooltip>
                ) : pending ? (
                    <Tooltip title="Connection pending — finish or retry connecting">
                        <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorWarning)]" />
                    </Tooltip>
                ) : null
            }
            description={description}
            tags={shownCategories}
            meta={
                typeof actionsCount === "number" && actionsCount > 0 ? (
                    <span className="flex items-center gap-1 text-[10px] text-[var(--ag-colorTextTertiary)]">
                        <Lightning size={11} weight="fill" />
                        {actionsCount}
                    </span>
                ) : undefined
            }
        />
    )
}
