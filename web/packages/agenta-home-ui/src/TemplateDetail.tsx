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
 * Two shells, swapped at `lg`. Beside the results there is room for the shared `FilterRailLayout`:
 * identity and the decision live in the rail, the reading half scrolls beside it. On a phone that
 * rail is the whole viewport and the reading half is a slit, so the page becomes what it is — one
 * scrolling document — with only the Use button pinned, as a footer bar.
 *
 * The host supplies its markdown renderer — AGENTS.md is markdown, and each app already has one
 * (the desktop's chat renderer, mobile's Streamdown) that the package must not duplicate.
 */
import type {ReactNode} from "react"

import {PROVIDERS, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {EnhancedButton, FilterRailLayout, Tag} from "@agenta/ui/components/presentational"
import {EmptyState, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, LightningIcon} from "@phosphor-icons/react"
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
}

const SectionLabel = ({children}: {children: ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
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
}: TemplateDetailProps) => {
    if (!template) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <EmptyState image="simple" description="Template not found" />
            </div>
        )
    }

    const tools = template.requiredIntegrations.flatMap((integration) =>
        integration.tools.map((tool) => ({...tool, provider: integration.slug})),
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

    const meta = (
        <>
            {template.requiredIntegrations.length ? (
                <section className="flex flex-col gap-2">
                    <SectionLabel>Connections it uses</SectionLabel>
                    {template.requiredIntegrations.map((integration) => (
                        <DetailRow
                            key={integration.slug}
                            label={PROVIDERS[integration.slug]?.label ?? integration.slug}
                            detail={integration.scope}
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

    const body = (
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

            <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-2">
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

    return (
        <>
            {/* Phone: one document between two pinned bars — the way back and which template you
                are reading on top, the decision at the bottom. Everything else scrolls, instead of
                a rail that eats the screen to keep the same two things in view. */}
            <div className="flex min-h-0 flex-1 flex-col lg:hidden">
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
                    {body}
                </div>
                <div className="box-border shrink-0 border-x-0 border-b-0 border-t border-solid border-colorBorderSecondary bg-colorBgContainer px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
                    {useButton(true)}
                </div>
            </div>

            <FilterRailLayout
                className="hidden lg:flex"
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
                {body}
            </FilterRailLayout>
        </>
    )
}
