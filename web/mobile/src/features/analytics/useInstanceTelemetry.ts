import {useQuery} from "@tanstack/react-query"

import {getEnv} from "@/lib/env"

import {fetchInstanceTelemetry, type InstanceTelemetry} from "./client"

/** The API's answer for the signed-in user; null until it arrives or without a project key. */
export const useInstanceTelemetry = (
    userId: string | null | undefined,
): InstanceTelemetry | null => {
    const {data} = useQuery({
        queryKey: ["instance-telemetry", userId],
        queryFn: fetchInstanceTelemetry,
        enabled: Boolean(userId && getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    })
    return data ?? null
}
