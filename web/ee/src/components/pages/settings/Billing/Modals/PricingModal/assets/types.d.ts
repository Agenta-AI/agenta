import {ModalProps} from "antd"

import {BillingPlan, SubscriptionType} from "@/oss/services/billing/types"

export interface PricingModalProps extends ModalProps {
    onCancelSubscription: () => void
}

export interface PricingModalContentProps {
    onCloseModal: () => void
    onCancelSubscription: () => void
}

export interface PricingPlan {
    key: string
    title: string
    price: string
    description: string
    priceDescription: string
    bulletPoints: string[]
}

export interface PricingCardProps {
    plan: BillingPlan
    currentPlan: SubscriptionType | null
    onOptionClick: (plan: BillingPlan) => void
    isLoading: string | null
}
