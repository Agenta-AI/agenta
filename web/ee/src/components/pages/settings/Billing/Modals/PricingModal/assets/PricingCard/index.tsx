import {memo, useMemo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@agenta/primitive-ui/components/card"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {useAtomValue} from "jotai"

import {currentCatalogEntryAtom, freePlanSlugAtom} from "@/oss/state/access/atoms"

import {PricingCardProps} from "../types"

const PricingCard = ({plan, currentPlan, onOptionClick, isLoading}: PricingCardProps) => {
    const _isLoading = isLoading === plan.plan
    const currentCatalogEntry = useAtomValue(currentCatalogEntryAtom)
    const freePlanSlug = useAtomValue(freePlanSlugAtom)
    const isCurrentPlanCustom = currentCatalogEntry?.type === "custom"
    const isThisPlanCustom = plan.type === "custom"
    const isThisPlanFree = plan.plan === freePlanSlug

    const isDisabled = useMemo(() => {
        if (isLoading !== null && isLoading !== plan.plan) {
            return true
        }

        if (currentPlan?.plan === plan.plan) {
            return true
        }

        // No self-serve switching off a custom/enterprise plan.
        if (isCurrentPlanCustom) {
            return true
        }

        return false
    }, [isLoading, currentPlan?.plan, plan.plan, isCurrentPlanCustom])

    return (
        <Card
            key={plan.plan}
            size="sm"
            className="relative w-full md:w-1/3 hover:z-10 flex flex-col justify-between transition-shadow hover:shadow-md"
        >
            <CardHeader className="border-b [.border-b]:pb-3">
                <CardTitle className="text-sm font-medium">{plan.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
                <div className="flex flex-col h-[300px]">
                    <div className="flex flex-col gap-1">
                        <span className="text-lg font-bold">
                            {plan.price
                                ? `${plan.price.base?.starting_at ? "Starts at " : ""} $
                            ${plan.price?.base?.amount} /month`
                                : "Contact us"}
                        </span>

                        <span className="font-medium text-sm">{plan.description}</span>
                    </div>

                    <ul className="list-disc pl-5 overflow-auto">
                        {plan.features?.map((point, idx) => {
                            return (
                                <li className="text-[var(--ag-c-586673)]" key={idx}>
                                    {point}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            </CardContent>
            <CardFooter>
                {isThisPlanCustom ? (
                    <Button
                        disabled={isDisabled}
                        className="w-full"
                        variant={isCurrentPlanCustom ? "link" : "default"}
                        onClick={() =>
                            window.open("https://cal.com/mahmoud-mabrouk-ogzgey/demo", "_blank")
                        }
                    >
                        {isCurrentPlanCustom ? "Current plan" : "Talk to us"}
                    </Button>
                ) : (
                    <Button
                        disabled={isDisabled || _isLoading}
                        className="w-full"
                        onClick={() => onOptionClick(plan)}
                        variant={
                            currentPlan?.plan === plan.plan
                                ? "link"
                                : isThisPlanFree
                                  ? "ghost"
                                  : "outline"
                        }
                    >
                        {_isLoading ? <Spinner /> : null}
                        {currentPlan?.plan === plan.plan
                            ? "Current plan"
                            : isThisPlanFree
                              ? `Move to ${plan.title}`
                              : `Upgrade to ${plan.title}`}
                    </Button>
                )}
            </CardFooter>
        </Card>
    )
}

export default memo(PricingCard)
