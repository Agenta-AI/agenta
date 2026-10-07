import {useProfile} from "@agenta/entities/profile"

import {PageTitle} from "@/components/PageTitle"

import {useEphemeralAgent} from "../agents/useEphemeralAgent"
import {useBindProjectContext} from "../context/useBindProjectContext"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingFlowHost} from "./OnboardingFlowHost"
import {OnboardingFlowError} from "./states/OnboardingFlowError"
import {OnboardingFlowSkeleton} from "./states/OnboardingFlowSkeleton"

/** The guided first-agent flow on its own page; full page, no app shell yet. */
export const OnboardingFlowScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const profile = useProfile()
    const {entityId, error, retry} = useEphemeralAgent(true)

    return (
        <>
            <PageTitle title={ONBOARDING_COPY.pageTitle} />
            {error ? (
                <OnboardingFlowError onRetry={retry} />
            ) : !profile.isPending ? (
                <OnboardingFlowHost
                    base={`/w/${workspaceId}/p/${projectId}`}
                    projectId={projectId}
                    entityId={entityId}
                    userId={profile.user?.id ?? null}
                />
            ) : (
                <OnboardingFlowSkeleton />
            )}
        </>
    )
}
