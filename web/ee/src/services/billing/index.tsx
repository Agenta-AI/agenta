import useSWR from "swr"

import {DEFAULT_UUID, getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

import {BillingPlan, DataUsageType, SubscriptionType} from "./types"

export const useUsageData = () => {
    const {data, isLoading, mutate, ...restData} = useSWR(`${getAgentaApiUrl()}/billing/usage`, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return {
        usage: data as DataUsageType,
        isUsageLoading: isLoading,
        mutateUsage: mutate,
        ...restData,
    }
}

export const useSubscriptionData = () => {
    const {projectId} = getCurrentProject()

    const {data, isLoading, mutate, ...restData} = useSWR(
        projectId === DEFAULT_UUID
            ? null
            : `${getAgentaApiUrl()}/billing/subscription?project_id=${projectId}`,
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return {
        subscription: data as SubscriptionType,
        isSubLoading: isLoading,
        mutateSubscription: mutate,
        ...restData,
    }
}

export const usePricingPlans = () => {
    const {data, isLoading, ...restData} = useSWR(`${getAgentaApiUrl()}/billing/plans`, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return {plans: data as BillingPlan[], isLoadingPlan: isLoading, ...restData}
}

export const switchSubscription = async (payload: {plan: string}) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/billing/plans/switch?plan=${payload.plan}`,
    )

    return response
}

export const cancelSubscription = async () => {
    const response = await axios.post(`${getAgentaApiUrl()}/billing/subscription/cancel`)

    return response
}

export const checkoutNewSubscription = async (payload: {plan: string; success_url: string}) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/billing/stripe/checkouts/?plan=${payload.plan}&success_url=${payload.success_url}`,
    )

    return response
}

export const editSubscriptionInfo = async () => {
    const response = await axios.post(`${getAgentaApiUrl()}/billing/stripe/portals/`)

    return response
}
