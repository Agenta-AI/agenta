import type {ReactNode} from "react"

import {Button, cn} from "@agenta/ui/ui"
import {ArrowRight, ArrowSquareOut, Key} from "@phosphor-icons/react"

type PlanState = "connected" | "attention" | "available"

export interface SubscriptionPlan {
    key: string
    logo: ReactNode
    name: string
    /** The plan's current line: who is signed in, what went wrong, or how to start. */
    detail: string
    state: PlanState
    /** `neutral` takes the theme's ink; `clay` is Anthropic's brand color. */
    brand: "neutral" | "clay"
    action: {label: string; onClick: () => void; external?: boolean}
}

const STATE_LABEL: Record<Exclude<PlanState, "available">, string> = {
    connected: "Connected",
    attention: "Needs sign-in",
}

const BRAND = {
    neutral: {
        cell: "border-border bg-[linear-gradient(160deg,color-mix(in_srgb,var(--ag-colorText)_9%,transparent),transparent_70%)]",
        tile: "bg-foreground text-background",
        button: "border-transparent bg-foreground text-background hover:bg-foreground/85",
    },
    clay: {
        cell: "border-[#d97757]/30 bg-[linear-gradient(160deg,color-mix(in_srgb,#d97757_24%,transparent),transparent_70%)]",
        tile: "bg-[#d97757] text-[#1a0f0b]",
        button: "border-transparent bg-[#d97757] text-[#1a0f0b] hover:bg-[#d97757]/85",
    },
} as const

const PlanCell = ({plan}: {plan: SubscriptionPlan}) => {
    const brand = BRAND[plan.brand]
    const ready = plan.state === "connected"
    return (
        <div
            className={cn(
                "flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-solid p-3.5",
                brand.cell,
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <span
                    className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]",
                        brand.tile,
                    )}
                >
                    {plan.logo}
                </span>
                {plan.state === "available" ? null : (
                    <span
                        className={cn(
                            "flex items-center gap-1.5 text-[11.5px] font-medium",
                            ready ? "text-colorSuccess" : "text-colorWarning",
                        )}
                    >
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        {STATE_LABEL[plan.state]}
                    </span>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold text-foreground">{plan.name}</span>
                    <span
                        className="truncate text-[12.5px] text-muted-foreground"
                        title={plan.detail}
                    >
                        {plan.detail}
                    </span>
                </div>
                <Button
                    variant={ready ? "outline" : "default"}
                    onClick={plan.action.onClick}
                    className={cn("w-full", ready ? null : brand.button)}
                >
                    {plan.action.label}
                    {plan.action.external ? (
                        <ArrowSquareOut size={13} />
                    ) : ready ? null : (
                        <ArrowRight size={14} />
                    )}
                </Button>
            </div>
        </div>
    )
}

/** AI providers' lead: run agents on a plan the team already pays for, ahead of API keys. */
export const SubscriptionsBanner = ({plans}: {plans: SubscriptionPlan[]}) => (
    <section className="ag-living-border rounded-2xl">
        <div className="grid grid-cols-1 gap-2.5 rounded-[15px] bg-background p-2.5 sm:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,1fr))]">
            <div className="flex min-h-[150px] flex-col justify-between gap-4 rounded-xl p-3">
                <span className="flex w-fit items-center gap-1.5 rounded-full border border-solid border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[11.5px] font-medium text-colorPrimaryText">
                    <Key size={12} />
                    No API key needed
                </span>
                <div className="flex flex-col gap-1.5">
                    <h2 className="m-0 text-[18px] font-semibold leading-6 tracking-[-0.015em] text-foreground">
                        Bring your own plan
                    </h2>
                    <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                        Agents run on your ChatGPT or Claude subscription instead of an API key.
                    </p>
                </div>
            </div>
            {plans.map((plan) => (
                <PlanCell key={plan.key} plan={plan} />
            ))}
        </div>
    </section>
)
