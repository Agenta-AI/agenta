import {PageLayout} from "@agenta/ui"
import {ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, LightningIcon} from "@phosphor-icons/react"
import {Button, Empty, Tag, Tooltip} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import useURL from "@/oss/hooks/useURL"

import {AGENT_TEMPLATES, PROVIDERS} from "../../assets/templates"

const SectionLabel = ({children}: {children: React.ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

/**
 * One template, in full.
 *
 * Everything here is a field the template already declares — connections and their scopes, the
 * tools it calls, its AGENTS.md, when it fires, its example session (labelled as an example).
 * The design's usage counter, "saves ~2h/week" and last-updated date have nothing behind them,
 * so they are absent rather than invented.
 */
const TemplateDetail = ({templateKey}: {templateKey: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()
    const template = AGENT_TEMPLATES.find((entry) => entry.key === templateKey)

    if (!template) {
        return (
            <PageLayout className="grow min-h-0">
                <Empty description="Template not found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </PageLayout>
        )
    }

    const tools = template.requiredIntegrations.flatMap((integration) =>
        integration.tools.map((tool) => ({...tool, provider: integration.slug})),
    )

    return (
        <PageLayout className="grow min-h-0 !px-14 !pt-0">
            <div className="flex min-h-0 w-full flex-1 flex-col gap-10 lg:flex-row lg:gap-0">
                {/* Identity and what it needs — a rail, not a column: it bleeds to the page's own
                    edges and carries the divider, so the decision half is a distinct surface from
                    the reading half rather than the same page with a gap down the middle. */}
                <aside className="box-border flex w-full shrink-0 flex-col gap-6 lg:-mb-4 lg:-ml-14 lg:w-[344px] lg:border-0 lg:border-r lg:border-solid lg:border-colorBorderSecondary lg:bg-colorFillQuaternary lg:px-6 lg:py-6">
                    <Link
                        href={`${baseAppURL}/agent-templates`}
                        className="inline-flex w-fit items-center gap-1 text-xs !text-colorTextSecondary"
                    >
                        <ArrowLeftIcon size={14} />
                        All templates
                    </Link>

                    <div className="flex flex-col gap-3">
                        <span
                            aria-hidden
                            className="flex size-12 items-center justify-center rounded-full text-base font-semibold text-white"
                            style={{backgroundColor: template.color}}
                        >
                            {template.initials}
                        </span>
                        <h1 className="m-0 text-2xl font-semibold text-colorText">
                            {template.name}
                        </h1>
                        <p className="m-0 text-sm leading-relaxed text-colorTextSecondary">
                            {template.overview || template.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Tag>{template.category}</Tag>
                            <Tag>{template.trigger}</Tag>
                        </div>
                    </div>

                    <Button
                        type="primary"
                        size="large"
                        onClick={() =>
                            void router.push(`${baseAppURL}?new=1&template=${template.key}`)
                        }
                    >
                        Use this template
                        <ArrowRightIcon size={14} />
                    </Button>

                    {template.requiredIntegrations.length ? (
                        <section className="flex flex-col gap-2">
                            <SectionLabel>Connections it uses</SectionLabel>
                            {template.requiredIntegrations.map((integration) => (
                                <div
                                    key={integration.slug}
                                    className="box-border flex items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated px-3 py-2"
                                >
                                    <span className="shrink-0 text-sm text-colorText">
                                        {PROVIDERS[integration.slug]?.label ?? integration.slug}
                                    </span>
                                    <Tooltip title={integration.scope}>
                                        <span className="ml-auto min-w-0 truncate text-right text-xs text-colorTextTertiary">
                                            {integration.scope}
                                        </span>
                                    </Tooltip>
                                </div>
                            ))}
                        </section>
                    ) : null}

                    {template.triggerDescription ? (
                        <section className="flex flex-col gap-2">
                            <SectionLabel>Also included</SectionLabel>
                            <div className="box-border flex items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgElevated px-3 py-2">
                                <LightningIcon
                                    size={14}
                                    weight="fill"
                                    className="shrink-0 text-colorTextTertiary"
                                />
                                <span className="shrink-0 text-sm text-colorText">Trigger</span>
                                <Tooltip title={template.triggerDescription}>
                                    <span className="ml-auto min-w-0 truncate text-right text-xs text-colorTextTertiary">
                                        {template.triggerDescription}
                                    </span>
                                </Tooltip>
                            </div>
                        </section>
                    ) : null}
                </aside>

                {/* What it will actually do. */}
                <div className="flex min-w-0 flex-1 flex-col gap-6 lg:py-4 lg:pl-10">
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
                            {/* Say what it is. An illustrative run presented as a real one is a
                                lie about what the agent has already done for someone. */}
                            <span className="text-xs text-colorTextTertiary">
                                An example of how this template runs — not a recorded session.
                            </span>
                        </section>
                    ) : null}

                    <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-2">
                        <section className="flex min-w-0 flex-col gap-2">
                            <SectionLabel>Instructions · AGENTS.md</SectionLabel>
                            {/* AGENTS.md is markdown — headings and lists are how it's written,
                                and a <pre> printed the syntax instead of the structure. The chat's
                                own renderer, so a template's instructions read the same here as
                                they do in a conversation. */}
                            <div className="box-border max-h-[420px] overflow-auto rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4">
                                <Markdown
                                    content={template.instructions}
                                    className="!text-[13px]"
                                />
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
            </div>
        </PageLayout>
    )
}

export default TemplateDetail
