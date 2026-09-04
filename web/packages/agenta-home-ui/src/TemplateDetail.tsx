/**
 * THE template detail view — one starter template in full. Extracted from the desktop page (which
 * now renders this), so every app shows the same fields, in the same order, with the same claims.
 *
 * Everything here is a field the template already declares: its connections and their scopes, the
 * tools it calls, its AGENTS.md, when it fires. The design's usage counter, "saves ~2h/week" and
 * last-updated date have nothing behind them, so they are absent rather than invented; the example
 * session is labelled as illustrative, because an authored run presented as a real one is a lie
 * about what the agent has done for someone.
 *
 * Two shells, swapped at `lg`. On a phone the page is what it is — one scrolling document —
 * with only the Use button pinned, as a footer bar. Above `lg` the desktop shell is chosen by
 * `layout` (see the prop): the default `"toolbar"` joins the shared page shape, `"rail"` keeps
 * the `FilterRailLayout` where identity and the decision live beside the reading half.
 *
 * The host supplies its markdown renderer — AGENTS.md is markdown, and each app already has one
 * (the desktop's chat renderer, mobile's Streamdown) that the package must not duplicate.
 */
import type {ReactNode} from "react"

import {PROVIDERS, templateConnections, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {pageContentWidthClass, pageGutterClass} from "@agenta/ui/components/page-width"
import {EnhancedButton, FilterRailLayout, Tag} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {EmptyState, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, LightningIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import Link from "next/link"

export interface TemplateDetailProps {
    /** Absent = an unknown key in the URL; the view says so rather than rendering blanks. */
    template: AgentStarterTemplate | undefined
    /** Back to the gallery. */
    allTemplatesHref: string
    /** Create from this template. The host decides what that means (seed + where it lands). */
    onUseTemplate: (template: AgentStarterTemplate) => void
    /** A create is in flight — the button reports it instead of accepting a second press. */
    busy?: boolean
    /** AGENTS.md is markdown; without a renderer it falls back to preformatted text. */
    renderMarkdown?: (markdown: string) => ReactNode
    /**
     * The desktop (`lg` and up) shell. Phones get the one-document shell either way.
     *
     * `"toolbar"` (the default) is the shared page shape: back link, identity and the one action
     * on the page's own top line, over the shared content column, with a single scroller below so
     * that pinned action stays reachable on a bounded route. `"rail"` is the browse-rail variant —
     * identity and the decision in a 344px rail beside the reading half.
     */
    layout?: "toolbar" | "rail"
}

const SectionLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-xs font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

/** One boxed row — a connection, or the trigger. Label left, its scope truncated right. */
const DetailRow = ({icon, label, detail}: {icon?: ReactNode; label: string; detail: string}) => (
    <div className="box-border flex items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated px-3 py-2">
        {icon}
        <span className="shrink-0 text-sm text-colorText">{label}</span>
        <SimpleTooltip title={detail}>
            <span className="ml-auto min-w-0 truncate text-right text-xs text-colorTextTertiary">
                {detail}
            </span>
        </SimpleTooltip>
    </div>
)

export const TemplateDetail = ({
    template,
    allTemplatesHref,
    onUseTemplate,
    busy = false,
    renderMarkdown,
    layout = "toolbar",
}: TemplateDetailProps) => {
    // Which shell to BUILD. Declared above the early return, because hooks cannot follow one.
    const wide = useMediaQuery("(min-width: 1024px)")

    if (!template) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <EmptyState image="simple" description="Template not found" />
            </div>
        )
    }

    const slots = templateConnections(template)
    // The primary option fronts the Tools list: an alternative's tools are the same job done
    // elsewhere, and listing both would read as twice the work.
    const tools = slots.flatMap((slot) =>
        slot.primary.tools.map((tool) => ({...tool, provider: slot.primary.slug})),
    )

    const backLink = (
        <Link
            href={allTemplatesHref}
            className="inline-flex w-fit items-center gap-1 text-xs !text-colorTextSecondary"
        >
            <ArrowLeftIcon size={14} />
            All templates
        </Link>
    )

    const identity = (
        <div className="flex flex-col gap-3">
            <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full text-base font-semibold text-white"
                style={{backgroundColor: template.color}}
            >
                {template.initials}
            </span>
            <h1 className="m-0 text-2xl font-semibold text-colorText">{template.name}</h1>
            <p className="m-0 text-sm leading-relaxed text-colorTextSecondary">
                {template.overview || template.description}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
                <Tag>{template.category}</Tag>
                <Tag>{template.trigger}</Tag>
            </div>
        </div>
    )

    const useButton = (block?: boolean) => (
        <EnhancedButton
            type="primary"
            size="large"
            block={block}
            loading={busy}
            onClick={() => onUseTemplate(template)}
        >
            Use this template
            <ArrowRightIcon size={14} />
        </EnhancedButton>
    )

    const providerLabel = (slug: string) => PROVIDERS[slug]?.label ?? slug
    /** "GitHub or GitLab" — the slot named by everything that satisfies it. */
    const slotLabel = (slot: (typeof slots)[number]) =>
        [slot.primary.slug, ...(slot.alternatives ?? [])].map(providerLabel).join(" or ")

    const requiredSlots = slots.filter((slot) => slot.required)
    const optionalSlots = slots.filter((slot) => !slot.required)

    const meta = (
        <>
            {requiredSlots.length ? (
                <section className="flex flex-col gap-2">
                    <SectionLabel>Connections it uses</SectionLabel>
                    {requiredSlots.map((slot) => (
                        <DetailRow
                            key={slot.primary.slug}
                            // "GitHub or GitLab" — a slot names every provider that satisfies it,
                            // so an alternative can no longer vanish between card and detail.
                            label={slotLabel(slot)}
                            detail={slot.primary.scope}
                        />
                    ))}
                </section>
            ) : null}

            {optionalSlots.length ? (
                <section className="flex flex-col gap-2">
                    <SectionLabel>Optional connections</SectionLabel>
                    {optionalSlots.map((slot) => (
                        <DetailRow
                            key={slot.primary.slug}
                            label={slotLabel(slot)}
                            detail={slot.role}
                        />
                    ))}
                </section>
            ) : null}

            {template.triggerDescription ? (
                <section className="flex flex-col gap-2">
                    <SectionLabel>Also included</SectionLabel>
                    <DetailRow
                        icon={
                            <LightningIcon
                                size={14}
                                weight="fill"
                                className="shrink-0 text-colorTextTertiary"
                            />
                        }
                        label="Trigger"
                        detail={template.triggerDescription}
                    />
                </section>
            ) : null}
        </>
    )

    /**
     * `stacked` is the toolbar shell's case: its main column is bounded by the shared content
     * width, and AGENTS.md at half of that wrapped every other word.
     */
    const renderBody = (stacked = false) => (
        <div className="flex min-w-0 flex-col gap-6">
            {template.example ? (
                <section className="flex flex-col gap-2">
                    <SectionLabel>Example session</SectionLabel>
                    <div className="box-border flex flex-col gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4">
                        <span className="w-fit self-end rounded-lg bg-colorFillTertiary px-3 py-1.5 text-sm text-colorText">
                            {template.example.prompt}
                        </span>

                        <span className="text-xs text-colorTextTertiary">
                            {template.name} · {template.example.steps.length} steps
                        </span>
                        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                            {template.example.steps.map((step) => (
                                <li
                                    key={step}
                                    className="flex items-center gap-2 text-sm text-colorTextSecondary"
                                >
                                    <CheckCircleIcon
                                        size={14}
                                        className="shrink-0 text-colorSuccess"
                                    />
                                    {step}
                                </li>
                            ))}
                        </ol>

                        <p className="m-0 text-sm leading-relaxed text-colorText">
                            {template.example.reply}
                        </p>

                        {template.example.artifacts?.length || template.example.status ? (
                            <div className="flex flex-wrap items-center gap-2">
                                {template.example.artifacts?.map((artifact) => (
                                    <Tag key={artifact} className="!m-0 font-mono !text-xs">
                                        {artifact}
                                    </Tag>
                                ))}
                                {template.example.status ? (
                                    <Tag color="warning" className="!m-0">
                                        {template.example.status}
                                    </Tag>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    {/* Say what it is. */}
                    <span className="text-xs text-colorTextTertiary">
                        An example of how this template runs — not a recorded session.
                    </span>
                </section>
            ) : null}

            <div
                className={clsx(
                    "grid min-w-0 grid-cols-1 items-start gap-6",
                    !stacked && "xl:grid-cols-2",
                )}
            >
                <section className="flex min-w-0 flex-col gap-2">
                    <SectionLabel>Instructions · AGENTS.md</SectionLabel>
                    {/* The cap is a desktop concern; a scroller nested in a phone's own scroll is
                        a trap, and the instructions are short enough to read inline there. */}
                    <div className="box-border rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4 lg:max-h-[420px] lg:overflow-auto">
                        {renderMarkdown ? (
                            renderMarkdown(template.instructions)
                        ) : (
                            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] text-colorText">
                                {template.instructions}
                            </pre>
                        )}
                    </div>
                </section>

                {tools.length ? (
                    <section className="flex min-w-0 flex-col gap-2">
                        <SectionLabel>Tools it can call</SectionLabel>
                        <div className="box-border flex flex-col rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-2">
                            {tools.map((tool) => (
                                <div
                                    key={`${tool.provider}-${tool.name}`}
                                    className="flex items-center gap-2 rounded-lg px-2 py-2"
                                >
                                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-colorText">
                                        {tool.name}
                                    </span>
                                    <span className="shrink-0 text-xs text-colorTextTertiary">
                                        {PROVIDERS[tool.provider]?.label ?? tool.provider}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    )

    // Only the matching shell is built. Rendering both and hiding one with `lg:hidden` mounts
    // `identity`, `meta` and the body TWICE — the host's markdown renderer parsed the whole
    // AGENTS.md on every render of a shell nobody could see.
    // Phone: one document between two pinned bars — the way back and which template you are
    // reading on top, the decision at the bottom. Everything else scrolls, instead of a rail that
    // eats the screen to keep the same two things in view.
    if (!wide) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="box-border flex shrink-0 items-center gap-2 border-x-0 border-b border-t-0 border-solid border-colorBorderSecondary px-3 py-2">
                    <Link
                        href={allTemplatesHref}
                        aria-label="All templates"
                        className="flex size-8 shrink-0 items-center justify-center !text-colorTextSecondary"
                    >
                        <ArrowLeftIcon size={18} />
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-colorText">
                        {template.name}
                    </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4">
                    {identity}
                    {meta}
                    {renderBody()}
                </div>
                <div className="box-border shrink-0 border-x-0 border-b-0 border-t border-solid border-colorBorderSecondary bg-colorBgContainer px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
                    {useButton(true)}
                </div>
            </div>
        )
    }

    return layout === "rail" ? (
        <FilterRailLayout
            railClassName="lg:w-[344px]"
            contentClassName="overflow-y-auto px-6 py-6 lg:pl-10"
            rail={
                <>
                    {backLink}
                    {identity}
                    {useButton()}
                    {meta}
                </>
            }
        >
            {renderBody()}
        </FilterRailLayout>
    ) : (
        <div
            className={clsx(
                pageContentWidthClass,
                pageGutterClass,
                "hidden min-h-0 flex-1 flex-col gap-6 lg:flex",
            )}
        >
            {/* Top bar: where you are, how to get back, and the one action — on the page's
                        own top line, like every other detail surface. */}
            <div className="flex flex-col gap-3">
                {backLink}

                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <span
                            aria-hidden
                            className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                            style={{backgroundColor: template.color}}
                        >
                            {template.initials}
                        </span>
                        <h1 className="m-0 truncate text-2xl font-semibold text-colorText">
                            {template.name}
                        </h1>
                    </div>

                    {useButton()}
                </div>
            </div>

            {/* One scroller, as in the gallery: `/agent-templates*` is a full-height route,
                        so the layout frame is bounded and unscrolled content below the fold was
                        unreachable. Scrolling here keeps the back link and "Use this template"
                        pinned. */}
            <div className="flex min-h-0 w-full flex-1 flex-col gap-10 overflow-y-auto pb-2 pr-1 lg:flex-row">
                {/* What it needs, beside what it does — the same main + rail split the
                            agent overview uses, on one background. */}
                <aside className="box-border flex w-full shrink-0 flex-col gap-6 lg:order-last lg:w-1/3 lg:min-w-[280px] lg:max-w-[340px]">
                    <div className="flex flex-col gap-3">
                        <p className="m-0 text-sm leading-relaxed text-colorTextSecondary">
                            {template.overview || template.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Tag>{template.category}</Tag>
                            <Tag>{template.trigger}</Tag>
                        </div>
                    </div>

                    {meta}
                </aside>

                {/* What it will actually do. */}
                <div className="flex min-w-0 flex-1 flex-col">{renderBody(true)}</div>
            </div>
        </div>
    )
}
