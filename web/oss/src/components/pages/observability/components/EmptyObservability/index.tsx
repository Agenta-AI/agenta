import {memo} from "react"

import {EmptyObservability as PackagedEmptyObservability} from "@agenta/observability-ui"
import {useSetAtom} from "jotai"
import Link from "next/link"

import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"
import useURL from "@/oss/hooks/useURL"
import {setOnboardingWidgetActivationAtom} from "@/oss/lib/onboarding"

interface EmptyObservabilityProps {
    showOnboarding?: boolean
    rateLimited?: boolean
    rateLimitMessage?: string
}

/** Binds the host-only bits (onboarding widget, billing URL, video id) to the packaged shell. */
const EmptyObservability = (props: EmptyObservabilityProps) => {
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const {projectURL} = useURL()
    const subscriptionHref = projectURL
        ? `${projectURL}/settings?tab=billing&upgrade=true`
        : undefined

    return (
        <PackagedEmptyObservability
            {...props}
            videoId={EMPTY_STATE_VIDEOS.observability}
            onSetupTracing={() => setOnboardingWidgetActivation("tracing-snippet")}
            upgradeAction={
                subscriptionHref ? (
                    <Link href={subscriptionHref} className="font-medium">
                        Upgrade
                    </Link>
                ) : undefined
            }
        />
    )
}

export default memo(EmptyObservability)
