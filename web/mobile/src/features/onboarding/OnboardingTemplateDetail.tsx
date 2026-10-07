import {PROVIDERS, templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {TemplateProviderMarks} from "@agenta/home-ui"
import {Badge, Button} from "@agenta/ui/ui"
import {ArrowRight, Lightning} from "@phosphor-icons/react"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingTemplateTile} from "./OnboardingTemplateTile"

const copy = ONBOARDING_COPY.gallery

/** The focused template: what it connects, how it runs, and the way into the creator. */
export const OnboardingTemplateDetail = ({
    template,
    onUse,
}: {
    template: AgentStarterTemplate
    onUse: (template: AgentStarterTemplate) => void
}) => {
    const providers = templateProviderSlugs(template)
    const providerNames = providers.flatMap((slug) => PROVIDERS[slug]?.label ?? []).join(", ")
    const steps = template.example?.steps ?? []
    return (
        <section
            aria-label={template.name}
            className="border-border bg-background flex flex-col gap-5 rounded-xl border border-solid p-5"
        >
            <div className="flex items-start gap-3">
                <OnboardingTemplateTile template={template} large />
                <div className="min-w-0">
                    <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
                        {template.name}
                        <Badge>{copy.template}</Badge>
                    </h2>
                    <p className="text-muted-foreground m-0 mt-1 text-sm">
                        {template.description}
                    </p>
                </div>
            </div>
            {providers.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs font-medium">
                        {copy.connects}
                    </span>
                    <div className="flex items-center gap-2">
                        <TemplateProviderMarks providers={providers} />
                        <span className="truncate text-sm">{providerNames}</span>
                    </div>
                </div>
            ) : null}
            <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs font-medium">
                    {copy.howItWorks}
                </span>
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                    <li className="flex items-start gap-3">
                        <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
                            <Lightning size={13} />
                        </span>
                        <span className="text-sm">
                            <span className="text-muted-foreground block text-xs">{copy.when}</span>
                            {template.triggerDescription || template.trigger}
                        </span>
                    </li>
                </ol>
            </div>
            {steps.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs font-medium">
                        {copy.example}
                    </span>
                    <ol className="m-0 flex list-none flex-col gap-3 p-0">
                        {steps.map((step, index) => (
                            <li key={step} className="flex items-start gap-3">
                                <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                    {index + 1}
                                </span>
                                <span className="pt-0.5 text-sm">{step}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            ) : null}
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid pt-4">
                <span className="text-muted-foreground text-xs">{copy.review}</span>
                <Button onClick={() => onUse(template)}>
                    {copy.use}
                    <ArrowRight data-icon="inline-end" />
                </Button>
            </div>
        </section>
    )
}
