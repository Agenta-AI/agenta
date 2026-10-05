import type {ReactNode} from "react"

import {Button, cn} from "@agenta/ui/ui"
import {ArrowRight, ArrowSquareOut} from "@phosphor-icons/react"

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
                "flex min-w-0 flex-col gap-2.5 rounded-xl border border-solid p-3",
                brand.cell,
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <span
                    className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4",
                        brand.tile,
                    )}
                >
                    {plan.logo}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-foreground">
                            {plan.name}
                        </span>
                        {plan.state === "available" ? null : (
                            <span
                                aria-label={STATE_LABEL[plan.state]}
                                title={STATE_LABEL[plan.state]}
                                className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    ready ? "bg-colorSuccess" : "bg-colorWarning",
                                )}
                            />
                        )}
                    </span>
                    <span
                        className="truncate text-[12px] text-muted-foreground"
                        title={plan.detail}
                    >
                        {plan.detail}
                    </span>
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
    )
}

/** AI providers' lead: run agents on a plan the team already pays for, ahead of API keys. */
export const SubscriptionsBanner = ({plans}: {plans: SubscriptionPlan[]}) => (
    <section className="rounded-2xl border border-solid border-border bg-background">
        <div className="grid grid-cols-1 items-center gap-2 p-2 md:grid-cols-[minmax(0,1.1fr)_repeat(2,minmax(0,1fr))]">
            <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-1.5">
                <div className="flex flex-col gap-0.5">
                    <h2 className="m-0 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground">
                        Bring your own plan
                    </h2>
                    <p className="m-0 text-[12.5px] leading-[18px] text-muted-foreground">
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
