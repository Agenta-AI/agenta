import {IconTile} from "@agenta/ui/ui"
import {LightningIcon} from "@phosphor-icons/react"

import {AppTile} from "./AppTile"
import {howStepKicker, type HowStep} from "./marketplaceView"

/** The template's flow as a timeline: when it runs, then what it does with each app. */
export const HowItWorksSteps = ({steps}: {steps: HowStep[]}) => (
    <ol className="m-0 flex list-none flex-col p-0">
        {steps.map((step, index) => (
            <li
                key={step.kind === "trigger" ? "trigger" : step.number}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-3"
            >
                <div className="flex flex-col items-center">
                    {step.kind === "trigger" ? (
                        <IconTile size={32} tone="muted">
                            <LightningIcon weight="fill" />
                        </IconTile>
                    ) : (
                        <AppTile app={step.app} size="md" decorative />
                    )}
                    {index < steps.length - 1 ? (
                        <span
                            aria-hidden
                            className="my-1 min-h-3 w-0 flex-1 border-y-0 border-l border-r-0 border-dashed border-border"
                        />
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-col items-start gap-1 pb-5 pt-0.5">
                    <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
                        {howStepKicker(step)}
                    </span>
                    <span className="text-sm text-foreground">
                        {step.kind === "trigger" ? step.text : `${step.role}.`}
                    </span>
                    {step.kind === "connection" && step.scope ? (
                        <code className="text-muted-foreground rounded bg-colorFillTertiary px-1.5 py-0.5 font-mono text-xs">
                            {step.scope}
                        </code>
                    ) : null}
                </div>
            </li>
        ))}
    </ol>
)
