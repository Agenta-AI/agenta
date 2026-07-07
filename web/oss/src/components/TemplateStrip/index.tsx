import {useMemo, useState, type ButtonHTMLAttributes, type ReactNode} from "react"

import {DotsThree, EyeSlash} from "@phosphor-icons/react"
import {Dropdown} from "antd"
import {useAtom} from "jotai"
import {ChevronLeft, ChevronRight} from "lucide-react"

import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    templateCategories,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import {STRIP_COPY} from "./assets/constants"
import StripCard from "./components/StripCard"
import {useStripPager} from "./hooks/useStripPager"
import {stripHiddenAtom} from "./state"

export interface TemplateStripProps {
    /** Template registry (defaults to AGENT_TEMPLATES). */
    templates?: AgentTemplate[]
    /** Controlled provenance selection (highlights the picked card). */
    selectedTemplateKey: string | null
    /** Selects header affordances: playground surfaces get the hide menu; home never hides. */
    surface: "home" | "onboarding" | "agent-chat"
    onPick: (template: AgentTemplate) => void
    /** Called after the hidden atom is set (playground surfaces only). */
    onHide?: () => void
    /** CSS variable the right-edge fade blends into (defaults to the container surface). */
    surfaceColorVar?: string
    className?: string
}

/** 26px square header button (arrows + menu) — plain button so the spec's disabled colors apply.
 * Spreads rest props so antd Dropdown can inject its trigger handlers via cloneElement. */
const HeaderButton = ({
    label,
    disabled,
    children,
    className,
    ...rest
}: {
    label: string
    disabled?: boolean
    children: ReactNode
    className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        type="button"
        aria-label={label}
        disabled={disabled}
        {...rest}
        className={`flex size-[26px] items-center justify-center rounded-[7px] border border-solid bg-[var(--ag-colorBgContainer)] p-0 ${
            disabled ? "" : "cursor-pointer"
        } ${className ?? ""}`}
    >
        {children}
    </button>
)

/**
 * The shared template strip: a fixed-height, horizontally paged row of template cards with
 * category tabs. Purely presentational and controlled — picking a card only calls `onPick`
 * (callers own the composer fill, chip, and analytics). Playground surfaces can hide it
 * (shared localStorage atom); home always shows it.
 */
const TemplateStrip = ({
    templates = AGENT_TEMPLATES,
    selectedTemplateKey,
    surface,
    onPick,
    onHide,
    surfaceColorVar = "--ag-colorBgContainer",
    className,
}: TemplateStripProps) => {
    const hideable = surface !== "home"
    const [hidden, setHidden] = useAtom(stripHiddenAtom)
    const [activeCategory, setActiveCategory] = useState<string>(ALL_TEMPLATES_CATEGORY)

    const categories = useMemo(
        () => [ALL_TEMPLATES_CATEGORY, ...templateCategories()],
        // templateCategories reads the static registry; recompute only for a custom list.
        [],
    )
    const countFor = (category: string) =>
        category === ALL_TEMPLATES_CATEGORY
            ? templates.length
            : templates.filter((t) => t.category === category).length

    const filtered = useMemo(
        () =>
            activeCategory === ALL_TEMPLATES_CATEGORY
                ? templates
                : templates.filter((t) => t.category === activeCategory),
        [templates, activeCategory],
    )

    const {scrollerRef, atStart, atEnd, counterLabel, showPager, pageBy, resetScroll} =
        useStripPager(filtered.length)

    if (hideable && hidden) {
        return (
            <div className={`text-[12.5px] text-[var(--ag-colorTextTertiary)] ${className ?? ""}`}>
                {STRIP_COPY.hiddenLine} ·{" "}
                <button
                    type="button"
                    onClick={() => setHidden(false)}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-[var(--ag-colorTextSecondary)] underline [text-underline-offset:3px]"
                >
                    {STRIP_COPY.showAgain}
                </button>
            </div>
        )
    }

    return (
        <div className={className}>
            {/* Header: label + tabs + right cluster (counter, arrows, optional hide menu). */}
            <div className="flex items-center gap-[14px]">
                <span className="text-[14.5px] font-semibold text-[var(--ag-colorText)]">
                    {STRIP_COPY.label}
                </span>
                <div className="flex items-center">
                    {categories.map((category) => {
                        const active = category === activeCategory
                        return (
                            <button
                                key={category}
                                type="button"
                                aria-pressed={active}
                                onClick={() => {
                                    setActiveCategory(category)
                                    resetScroll()
                                }}
                                className={`cursor-pointer rounded-t-md border-0 border-b-2 border-solid bg-transparent px-[11px] py-[5px] text-[13px] hover:bg-[var(--ag-colorFillTertiary)] ${
                                    active
                                        ? "border-b-[var(--ag-colorPrimary)] font-semibold text-[var(--ag-colorText)]"
                                        : "border-b-transparent font-normal text-[var(--ag-colorTextTertiary)]"
                                }`}
                            >
                                {category}
                                <span className="ml-1.5 text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    {countFor(category)}
                                </span>
                            </button>
                        )
                    })}
                </div>
                <div className="ml-auto flex items-center gap-[7px]">
                    {showPager ? (
                        <>
                            <span className="mr-0.5 text-xs text-[var(--ag-colorTextTertiary)]">
                                {counterLabel}
                            </span>
                            <HeaderButton
                                label="Previous templates"
                                disabled={atStart}
                                onClick={() => pageBy(-1)}
                                className={
                                    atStart
                                        ? "border-[var(--ag-colorBorderSecondary)] text-[var(--ag-colorTextQuaternary)]"
                                        : "border-[var(--ag-colorPrimary)] text-[var(--ag-colorPrimary)]"
                                }
                            >
                                <ChevronLeft size={14} strokeWidth={2} />
                            </HeaderButton>
                            <HeaderButton
                                label="Next templates"
                                disabled={atEnd}
                                onClick={() => pageBy(1)}
                                className={
                                    atEnd
                                        ? "border-[var(--ag-colorBorderSecondary)] text-[var(--ag-colorTextQuaternary)]"
                                        : "border-[var(--ag-colorPrimary)] text-[var(--ag-colorPrimary)]"
                                }
                            >
                                <ChevronRight size={14} strokeWidth={2} />
                            </HeaderButton>
                        </>
                    ) : null}
                    {hideable ? (
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    {
                                        key: "hide",
                                        icon: <EyeSlash size={14} />,
                                        label: STRIP_COPY.hideMenuItem,
                                        onClick: () => {
                                            setHidden(true)
                                            onHide?.()
                                        },
                                    },
                                ],
                            }}
                        >
                            <HeaderButton
                                label="Strip options"
                                className="border-transparent text-[var(--ag-colorTextTertiary)] hover:bg-[var(--ag-colorFillTertiary)]"
                            >
                                <DotsThree size={16} weight="bold" />
                            </HeaderButton>
                        </Dropdown>
                    ) : null}
                </div>
            </div>

            {/* Card row: native horizontal scroll, hidden scrollbar, snap, right-edge fade. */}
            <div className="relative mt-3">
                <div
                    ref={scrollerRef}
                    className="flex snap-x snap-proximity gap-[14px] overflow-x-auto px-0.5 pb-1.5 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    {filtered.map((template) => (
                        <StripCard
                            key={template.key}
                            template={template}
                            selected={template.key === selectedTemplateKey}
                            onPick={onPick}
                        />
                    ))}
                </div>
                {showPager ? (
                    <div
                        aria-hidden
                        className="pointer-events-none absolute bottom-1.5 right-0 top-0 w-9"
                        style={{
                            background: `linear-gradient(to right, transparent, var(${surfaceColorVar}))`,
                        }}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default TemplateStrip
