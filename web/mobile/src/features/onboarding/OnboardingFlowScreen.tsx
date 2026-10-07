import {PageTitle} from "@/components/PageTitle"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingFlowHost} from "./OnboardingFlowHost"
import {OnboardingFlowError} from "./states/OnboardingFlowError"
import {OnboardingFlowSkeleton} from "./states/OnboardingFlowSkeleton"
import {useEphemeralAgent} from "./useEphemeralAgent"

/** The guided first-agent flow an empty project opens on; full page, no app shell yet. */
export const OnboardingFlowScreen = ({
    workspaceId,
    projectId,
    preview,
}: {
    workspaceId: string
    projectId: string
    /** `?onboarding-preview`: shown on any project, with no analytics or tool seeding. */
    preview: boolean
}) => {
    const {entityId, error, retry} = useEphemeralAgent(true)

    return (
        <>
            <PageTitle title={ONBOARDING_COPY.pageTitle} />
            {error ? (
                <OnboardingFlowError onRetry={retry} />
            ) : entityId ? (
                <OnboardingFlowHost
                    base={`/w/${workspaceId}/p/${projectId}`}
                    projectId={projectId}
                    entityId={entityId}
                    preview={preview}
                />
            ) : (
                <OnboardingFlowSkeleton />
            )}
        </>
    )
}
