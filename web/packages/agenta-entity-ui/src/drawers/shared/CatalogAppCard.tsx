/**
 * Catalog app card + logo — the provider tile shared by every Composio catalog grid (the
 * subscription "Choose a trigger" chooser AND the tools "Third-party integration" catalog), so
 * the app grid looks identical across triggers and tools. Dark-safe (`--ag-color*` tokens).
 */
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
    const shownCategories = (categories ?? []).filter(Boolean).slice(0, 2)
    const surface =
        variant === "subtle"
            ? "border-transparent bg-[var(--ag-colorFillQuaternary)] hover:border-[var(--ag-colorBorderSecondary)] hover:bg-[var(--ag-colorFillTertiary)]"
            : "border-[var(--ag-colorBorder)] bg-transparent hover:border-[var(--ag-colorPrimary)] hover:bg-[var(--ag-colorFillQuaternary)]"
    return (
        <button
            type="button"
            onClick={onClick}
            className={`group flex h-full min-h-[112px] cursor-pointer flex-col gap-2 rounded-lg border border-solid p-3 text-left ${surface}`}
        >
            <div className="flex items-center gap-2.5">
                <AppLogo logo={logo} size={28} />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{name}</span>
                    {connected ? (
                        <Tooltip title="Connected">
                            <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                        </Tooltip>
                    ) : pending ? (
                        <Tooltip title="Connection pending — finish or retry connecting">
                            <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorWarning)]" />
                        </Tooltip>
                    ) : null}
                </div>
            </div>
            {description ? (
                <p className="m-0 line-clamp-2 text-[11px] leading-snug text-[var(--ag-colorTextSecondary)]">
                    {description}
                </p>
            ) : (
                <span className="flex-1" />
            )}
            <div className="mt-auto flex items-center gap-1.5">
                {shownCategories.map((cat) => (
                    <span
                        key={cat}
                        className="truncate rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ag-colorTextSecondary)]"
                    >
                        {formatCategoryLabel(cat)}
                    </span>
                ))}
                {typeof actionsCount === "number" && actionsCount > 0 && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-[var(--ag-colorTextTertiary)]">
                        <Lightning size={11} weight="fill" />
                        {actionsCount}
                    </span>
                )}
            </div>
        </button>
    )
}
