import {categorySlug, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {
    Badge,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Button,
} from "@agenta/ui/ui"
import {CheckIcon, LinkSimpleIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {AppTileStack} from "./AppTileStack"
import {ExampleRun} from "./ExampleRun"
import {HowItWorksSteps} from "./HowItWorksSteps"
import {
    howItWorks,
    relatedTemplates,
    setupSteps,
    templateProviders,
    templateTools,
} from "./marketplaceView"
import {RelatedTemplates} from "./RelatedTemplates"
import {TemplateInstructions} from "./TemplateInstructions"
import {TemplateSection} from "./TemplateSection"
import {TemplateToolList} from "./TemplateToolList"
import {TemplateUseCard} from "./TemplateUseCard"
import {useCopyLink} from "./useCopyLink"

/** One template in full: identity, numbered sections, and the card that uses it. */
export const TemplatePage = ({
    template,
    all,
    marketplaceHref,
    busy,
    onUse,
}: {
    template: AgentStarterTemplate
    all: readonly AgentStarterTemplate[]
    marketplaceHref: string
    busy: boolean
    onUse: () => void
}) => {
    const link = useCopyLink()
    const tools = templateTools(template)
    const steps = howItWorks(template)
    const related = relatedTemplates(template, all)
    const categoryHref = `${marketplaceHref}?category=${categorySlug(template.category)}`
    const sections = [
        "overview",
        steps.length ? "how" : null,
        tools.length ? "tools" : null,
        "setup",
    ].filter((id): id is string => id !== null)
    const number = (id: string) => sections.indexOf(id) + 1

    return (
        <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between gap-3">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href={marketplaceHref}>Agent Marketplace</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <Link href={categoryHref}>{template.category}</Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>{template.name}</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
                {link.supported ? (
                    <Button variant="outline" size="sm" onClick={() => void link.copy()}>
                        {link.copied ? (
                            <CheckIcon data-icon="inline-start" />
                        ) : (
                            <LinkSimpleIcon data-icon="inline-start" />
                        )}
                        {link.copied ? "Link copied" : "Copy link"}
                    </Button>
                ) : null}
            </div>

            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
                <div className="flex min-w-0 flex-1 flex-col">
                    <AppTileStack apps={templateProviders(template)} size="xl" />
                    <h1 className="m-0 mt-5 text-2xl font-semibold text-foreground lg:text-[30px] lg:leading-9">
                        {template.name}
                    </h1>
                    <p className="text-muted-foreground m-0 mt-2 max-w-[620px] text-[15px] leading-relaxed">
                        {template.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                        <Badge>{template.category}</Badge>
                        {template.toolsSummary ? <Badge>{template.toolsSummary}</Badge> : null}
                    </div>

                    <div className="mt-4">
                        <TemplateSection number={number("overview")} title="Overview">
                            {template.overview ? (
                                <p className="m-0 text-base leading-relaxed text-foreground lg:text-lg">
                                    {template.overview}
                                </p>
                            ) : null}
                            {template.example ? <ExampleRun example={template.example} /> : null}
                            {template.instructions.trim() ? (
                                <TemplateInstructions markdown={template.instructions} />
                            ) : null}
                        </TemplateSection>
                        {steps.length ? (
                            <TemplateSection number={number("how")} title="How it works">
                                <HowItWorksSteps steps={steps} />
                            </TemplateSection>
                        ) : null}
                        {tools.length ? (
                            <TemplateSection number={number("tools")} title="Tools it can use">
                                <TemplateToolList tools={tools} columns={2} />
                            </TemplateSection>
                        ) : null}
                        <TemplateSection number={number("setup")} title="Set it up">
                            <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
                                {setupSteps(template).map((step, index) => (
                                    <li
                                        key={step.title}
                                        className="box-border flex flex-col gap-1.5 rounded-lg border border-solid border-border bg-card p-4"
                                    >
                                        <span className="text-muted-foreground font-mono text-xs">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <span className="text-sm font-medium text-foreground">
                                            {step.title}
                                        </span>
                                        <span className="text-muted-foreground text-xs leading-5">
                                            {step.text}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </TemplateSection>
                    </div>
                </div>

                <div className="w-full lg:sticky lg:top-4 lg:w-[320px] lg:shrink-0">
                    <TemplateUseCard template={template} busy={busy} onUse={onUse} />
                </div>
            </div>

            {related.length ? (
                <RelatedTemplates
                    category={template.category}
                    templates={related}
                    hrefOf={(other) => `${marketplaceHref}/${other.key}`}
                    categoryHref={categoryHref}
                />
            ) : null}
        </div>
    )
}
