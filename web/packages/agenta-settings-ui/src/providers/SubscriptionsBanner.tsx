import type {ReactNode} from "react"

import {Button, cn} from "@agenta/ui/ui"
import {ArrowSquareOut, Sparkle} from "@phosphor-icons/react"

type PlanState = "connected" | "attention" | "available"

export interface SubscriptionPlan {
    key: string
    logo: ReactNode
    name: string
    /** The plan's current line: who is signed in, what went wrong, or how to start. */
    detail: string
    state: PlanState
    action: {label: string; onClick: () => void; external?: boolean}
}

const STATE_LABEL: Record<PlanState, string | null> = {
    connected: "Connected",
    attention: "Needs sign-in",
    available: null,
}

const PlanTile = ({plan}: {plan: SubscriptionPlan}) => {
    const badge = STATE_LABEL[plan.state]
    return (
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-solid border-border bg-background/70 p-3 backdrop-blur-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-solid border-border bg-background shadow-xs [&_svg]:size-5">
                {plan.logo}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-foreground">
                        {plan.name}
                    </span>
                    {badge ? (
                        <span
                            className={cn(
                                "flex shrink-0 items-center gap-1.5 text-[12px] font-medium",
                                plan.state === "connected"
                                    ? "text-colorSuccess"
                                    : "text-colorWarning",
                            )}
                        >
                            <span aria-hidden className="size-1.5 rounded-full bg-current" />
                            {badge}
                        </span>
                    ) : null}
                </span>
                <span className="line-clamp-2 text-[12.5px] leading-[17px] text-muted-foreground">
                    {plan.detail}
                </span>
            </span>
            <Button
                variant={plan.state === "connected" ? "ghost" : "outline"}
                onClick={plan.action.onClick}
                className="shrink-0"
            >
                {plan.action.label}
                {plan.action.external ? <ArrowSquareOut size={13} /> : null}
            </Button>
        </div>
    )
}

/** AI providers' lead: run agents on a plan the team already pays for, ahead of API keys. */
export const SubscriptionsBanner = ({plans}: {plans: SubscriptionPlan[]}) => (
    <section className="relative overflow-hidden rounded-xl border border-solid border-border bg-[radial-gradient(120%_140%_at_100%_0%,color-mix(in_srgb,var(--ag-colorPrimary)_12%,transparent),transparent_60%)] p-5">
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-colorPrimaryText">
                    <Sparkle size={13} weight="fill" />
                    Subscriptions
                </span>
                <h2 className="m-0 text-[16px] font-semibold leading-6 text-foreground">
                    Run agents on the plan you already pay for
                </h2>
                <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                    Sign in with a ChatGPT or Claude subscription instead of managing API keys.
                </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
                {plans.map((plan) => (
                    <PlanTile key={plan.key} plan={plan} />
                ))}
            </div>
        </div>
    </section>
)
