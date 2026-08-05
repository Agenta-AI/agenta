import {PageLayout} from "@agenta/ui"
import {ArrowLeftIcon, ArrowRightIcon, LightningIcon} from "@phosphor-icons/react"
import {Button, Empty, Tag} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"

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
 * tools it calls, its AGENTS.md, when it fires. The design's usage counter, "saves ~2h/week" and
 * last-updated date have nothing behind them, so they are absent rather than invented; an example
 * session would be authored fiction per template and is a separate decision.
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
        <PageLayout className="grow min-h-0 !px-14">
            <Link
                href={`${baseAppURL}/agent-templates`}
                className="inline-flex w-fit items-center gap-1 text-xs !text-colorTextSecondary"
            >
                <ArrowLeftIcon size={14} />
                All templates
            </Link>

            <div className="flex min-h-0 w-full flex-1 flex-col gap-10 lg:flex-row">
                {/* Identity and what it needs — the decision column. */}
                <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-[320px]">
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
                                    <span className="ml-auto min-w-0 truncate text-right text-xs text-colorTextTertiary">
                                        {integration.scope}
                                    </span>
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
                                <span className="ml-auto min-w-0 truncate text-right text-xs text-colorTextTertiary">
                                    {template.triggerDescription}
                                </span>
                            </div>
                        </section>
                    ) : null}
                </aside>

                {/* What it will actually do. */}
                <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-6 xl:grid-cols-2">
                    <section className="flex min-w-0 flex-col gap-2">
                        <SectionLabel>Instructions · AGENTS.md</SectionLabel>
                        <pre className="m-0 box-border max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-solid border-colorBorderSecondary bg-colorBgElevated p-4 font-mono text-[13px] leading-relaxed text-colorTextSecondary">
                            {template.instructions}
                        </pre>
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
        </PageLayout>
    )
}

export default TemplateDetail
