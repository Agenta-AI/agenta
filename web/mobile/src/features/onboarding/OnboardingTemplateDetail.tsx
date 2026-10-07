import type {ReactNode} from "react"

import {PROVIDERS, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {ArrowRight, Lightning} from "@phosphor-icons/react"

import {AppTileStack} from "../marketplace/AppTileStack"
import {templateProviders} from "../marketplace/marketplaceView"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingTemplateTile} from "./OnboardingTemplateTile"

const copy = ONBOARDING_COPY.gallery
const MAX_STEPS = 4

/** "Gmail", "Gmail and Calendar", "Gmail, Slack and Calendar". */
const joinNames = (names: string[]) =>
    names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

interface Step {
    text: string
    /** The provider slug the step runs in, when the catalog says. */
    app: string | null
}

/** The authored example run when there is one, else the actions each connection is used for. */
const templateSteps = (template: AgentStarterTemplate): Step[] =>
    (template.example?.steps.length
        ? template.example.steps.map((text) => ({text, app: null}))
        : template.connections.flatMap((slot) =>
              (slot.primary.tools ?? []).map((tool) => ({text: tool.name, app: slot.primary.slug})),
          )
    ).slice(0, MAX_STEPS)

const NodeTile = ({children}: {children: ReactNode}) => (
    <span className="bg-background ring-border flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset">
        {children}
    </span>
)

const AppLogo = ({slug, size}: {slug: string; size: number}) =>
    PROVIDERS[slug] ? (
        <img
            src={PROVIDERS[slug].logo}
            alt=""
            style={{width: size, height: size}}
            className="object-contain"
        />
    ) : null

/** The focused template: what it connects, how it runs, and the way into the creator. */
export const OnboardingTemplateDetail = ({
    template,
    onUse,
}: {
    template: AgentStarterTemplate
    onUse: (template: AgentStarterTemplate) => void
}) => {
    const providers = templateProviders(template)
    const required = template.connections.some((slot) => slot.required)
    const steps = templateSteps(template)
    const nodes = [
        {
            key: "when",
            tile: <Lightning size={14} weight="fill" className="text-muted-foreground" />,
            label: copy.when,
            text: template.triggerDescription || template.trigger,
        },
        ...steps.map((step, index) => ({
            key: `${index}`,
            tile: step.app ? (
                <AppLogo slug={step.app} size={15} />
            ) : (
                <span className="text-muted-foreground text-xs font-medium">{index + 1}</span>
            ),
            label: copy.step(index + 1, step.app ? (PROVIDERS[step.app]?.label ?? null) : null),
            text: step.text,
        })),
    ]

    return (
        <section aria-label={template.name} className="bg-muted flex min-w-0 flex-col rounded-xl">
            <div className="flex items-start gap-3 p-3">
                <OnboardingTemplateTile template={template} size="panel" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="m-0 flex items-center gap-2 text-base font-semibold leading-6 tracking-[-0.01em]">
                        {template.name}
                        <span className="bg-background text-muted-foreground ring-border rounded-[5px] px-1.5 py-px text-[11px] font-medium leading-4 tracking-normal ring-1">
                            {copy.template}
                        </span>
                    </h2>
                    <p className="text-muted-foreground m-0 text-sm leading-5 text-pretty">
                        {template.description}
                    </p>
                </div>
            </div>
            <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
                {providers.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <span className={ONBOARDING_COPY.kickerClass}>{copy.connects}</span>
                        <div className="flex items-center gap-2.5">
                            <AppTileStack apps={providers} size="sm" decorative />
                            <span className="min-w-0 flex-1 text-sm leading-5">
                                {joinNames(providers.map((app) => app.name))}
                            </span>
                            <span className="text-muted-foreground text-[13px] leading-5">
                                {required ? copy.required : copy.optional}
                            </span>
                        </div>
                    </div>
                ) : null}
                <div className="flex flex-col gap-2">
                    <span className={ONBOARDING_COPY.kickerClass}>{copy.howItWorks}</span>
                    <ol className="m-0 flex list-none flex-col p-0">
                        {nodes.map((node, index) => (
                            <li key={node.key} className="flex gap-3">
                                <div className="flex w-7 shrink-0 flex-col items-center">
                                    <NodeTile>{node.tile}</NodeTile>
                                    {index < nodes.length - 1 ? (
                                        <span className="border-border min-h-2 w-0 flex-1 border-0 border-l border-dashed" />
                                    ) : null}
                                </div>
                                <div className="flex flex-col gap-0.5 pb-3">
                                    <span className={ONBOARDING_COPY.kickerClass}>{node.label}</span>
                                    <span className="text-sm leading-5">{node.text}</span>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
            <div className="flex flex-col gap-2 px-3 pb-3 pt-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-muted-foreground text-xs leading-[18px]">{copy.review}</span>
                <Button size="sm" className="max-sm:h-10 max-sm:w-full" onClick={() => onUse(template)}>
                    {copy.use}
                    <ArrowRight data-icon="inline-end" />
                </Button>
            </div>
        </section>
    )
}
