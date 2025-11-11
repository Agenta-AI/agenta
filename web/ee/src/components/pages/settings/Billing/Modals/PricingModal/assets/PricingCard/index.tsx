import {memo, useMemo} from "react"

import {Card, Button, Typography} from "antd"

import {Plan} from "@/oss/lib/Types"

import {PricingCardProps} from "../types"

const PricingCard = ({plan, currentPlan, onOptionClick, isLoading}: PricingCardProps) => {
    const _isLoading = isLoading === plan.plan
    const isDisabled = useMemo(
        () =>
            (isLoading !== null && isLoading !== plan.plan) ||
            currentPlan?.plan == plan.plan ||
            currentPlan?.plan == Plan.Business ||
            currentPlan?.plan == Plan.Enterprise,
        [isLoading, currentPlan, plan],
    )

    return (
        <Card
            hoverable
            key={plan.plan}
            className={`relative w-full md:w-1/4`}
            title={plan.title}
            classNames={{
                body: "!p-3 flex-1",
                header: "!p-3 !min-h-0",
                actions: "!p-3  [&_li]:!m-0",
            }}
            rootClassName="flex flex-col justify-between"
            actions={[
                plan.title == "Enterprise" || plan.title == "Business" ? (
                    <Button
                        disabled={isDisabled}
                        className="w-full"
                        type={
                            currentPlan?.plan == Plan.Business ||
                            currentPlan?.plan == Plan.Enterprise
                                ? "link"
                                : "primary"
                        }
                        onClick={() =>
                            window.open("https://cal.com/mahmoud-mabrouk-ogzgey/demo", "_blank")
                        }
                    >
                        {currentPlan?.plan == Plan.Business || currentPlan?.plan == Plan.Enterprise
                            ? "Current plan"
                            : "Talk to us"}
                    </Button>
                ) : (
                    <Button
                        disabled={isDisabled}
                        loading={_isLoading}
                        className="w-full"
                        onClick={() => onOptionClick(plan)}
                        type={currentPlan?.plan === plan.plan ? "link" : "default"}
                    >
                        {currentPlan?.plan === plan.plan
                            ? "Current plan"
                            : plan.plan === Plan.Hobby
                              ? "Move to Hobby"
                              : `Upgrade to ${plan.title}`}
                    </Button>
                ),
            ]}
        >
            <div className="flex flex-col h-[300px]">
                <div className="flex flex-col gap-1">
                    <Typography.Text className="text-lg font-bold">
                        {plan.price
                            ? `${plan.price.base?.starting_at ? "Starts at " : ""} $
                            ${plan.price?.base?.amount} /month`
                            : "Contact us"}
                    </Typography.Text>

                    <Typography.Text className="font-medium text-sm">
                        {plan.description}
                    </Typography.Text>
                </div>

                <ul className="-ml-5">
                    {plan.features?.map((point, idx) => {
                        return (
                            <li className="text-[#586673]" key={idx}>
                                {point}
                            </li>
                        )
                    })}
                </ul>
            </div>
        </Card>
    )
}

export default memo(PricingCard)
