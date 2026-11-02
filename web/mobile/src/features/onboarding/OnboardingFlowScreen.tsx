import {useProfile} from "@agenta/entities/profile"

import {PageTitle} from "@/components/PageTitle"
import {projectHomeUrl} from "@/lib/context"

import {useEphemeralAgent} from "../agents/useEphemeralAgent"
import {useBindProjectContext} from "../context/useBindProjectContext"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {OnboardingFlowHost} from "./OnboardingFlowHost"
import {isOnboardingInvited} from "./onboardingPending"
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
    // The questions need no agent, so a failed mint must not block an invited person.
    const invited = profile.user?.id ? isOnboardingInvited(profile.user.id) : false
    const {entityId, error, retry} = useEphemeralAgent(!profile.isPending && !invited)

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
                    userEmail={profile.user?.email ?? null}
                    homeUrl={projectHomeUrl({workspaceId, projectId})}
                />
            ) : (
                <OnboardingFlowSkeleton />
            )}
        </>
    )
}
