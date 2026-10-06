import {PageTitle} from "@/components/PageTitle"

import {type OnboardingVariant} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingFlowHost} from "./OnboardingFlowHost"
import {OnboardingFlowError} from "./states/OnboardingFlowError"
import {OnboardingFlowSkeleton} from "./states/OnboardingFlowSkeleton"
import {useEphemeralAgent} from "./useEphemeralAgent"
import {useOnboardingExperiment} from "./useOnboardingExperiment"

/** The guided first-agent flow an empty project opens on; full page, no app shell yet. */
export const OnboardingFlowScreen = ({
    workspaceId,
    projectId,
    previewVariant,
}: {
    workspaceId: string
    projectId: string
    /** `?onboarding-variant=`: show that variant without enrolling. */
    previewVariant: OnboardingVariant | null
}) => {
    const assignment = useOnboardingExperiment(previewVariant)
    const {entityId, error, retry} = useEphemeralAgent(true)

    return (
        <>
            <PageTitle title={ONBOARDING_COPY.pageTitle} />
            {error ? (
                <OnboardingFlowError onRetry={retry} />
            ) : assignment && entityId ? (
                <OnboardingFlowHost
                    base={`/w/${workspaceId}/p/${projectId}`}
                    projectId={projectId}
                    entityId={entityId}
                    assignment={assignment}
                    preview={previewVariant !== null}
                />
            ) : (
                <OnboardingFlowSkeleton />
            )}
        </>
    )
}
