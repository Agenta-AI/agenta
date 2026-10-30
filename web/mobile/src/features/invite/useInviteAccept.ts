import {useCallback, useEffect, useRef, useState} from "react"

import {acceptWorkspaceInvite} from "@agenta/entities/organization"
import {fetchProfile} from "@agenta/entities/profile"
import {message} from "@agenta/ui/app-message"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {useLogout} from "@/features/auth/useLogout"
import {isOnboardingPending, markOnboardingInvited} from "@/features/onboarding/onboardingPending"
import {fetchProjects, projectHomeUrl, writeLastContext} from "@/lib/context"
import {queryClient} from "@/lib/queryClient"

import {INVITE_JOINED_MESSAGE, inviteFailure, type InviteFailure} from "./inviteOutcome"
import {forgetInvite, readPendingInvite, type PendingInvite} from "./pendingInvite"

/** Accepts the kept invite once a session is confirmed, and owns what the person can do next. */
export const useInviteAccept = () => {
    const router = useRouter()
    const logout = useLogout()
    const [failure, setFailure] = useState<InviteFailure | null>(null)
    const startedRef = useRef(false)
    // AuthGate moves a signed-out person to /auth; the invite waits in storage meanwhile.
    const session = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const signedIn = session.data !== undefined && session.data.kind !== "unauthenticated"

    const openProject = useCallback(
        async (invite: PendingInvite, joined: string) => {
            forgetInvite()
            message.success(joined)
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["mobile", "projects"]}),
                queryClient.invalidateQueries({queryKey: ["orgs"]}),
            ])
            const context = {workspaceId: invite.organization_id, projectId: invite.project_id}
            writeLastContext(context)
            const user = await queryClient
                .fetchQuery({queryKey: ["profile"], queryFn: fetchProfile, staleTime: 30_000})
                .catch(() => null)
            if (user?.id && isOnboardingPending(user.id)) {
                markOnboardingInvited(user.id)
                const {workspaceId, projectId} = context
                await router.replace(
                    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/onboarding`,
                )
                return
            }
            await router.replace(projectHomeUrl(context))
        },
        [router],
    )

    const accept = useCallback(async () => {
        const invite = readPendingInvite()
        if (!invite) {
            await router.replace("/")
            return
        }
        try {
            await acceptWorkspaceInvite(
                {
                    token: invite.token,
                    email: invite.email,
                    organizationId: invite.organization_id,
                    workspaceId: invite.workspace_id,
                    projectId: invite.project_id,
                },
                true,
            )
        } catch (error) {
            const outcome = inviteFailure(error)
            if (outcome.alreadyAccepted) {
                await openProject(invite, outcome.message)
                return
            }
            setFailure(outcome)
            return
        }
        await openProject(invite, INVITE_JOINED_MESSAGE)
    }, [router, openProject])

    useEffect(() => {
        if (!signedIn || startedRef.current) return
        startedRef.current = true
        void accept()
    }, [signedIn, accept])

    return {
        failure,
        retry: () => {
            setFailure(null)
            void accept()
        },
        goBack: () => {
            forgetInvite()
            void router.replace("/")
        },
        // The invite stays kept, so signing in with the invited email accepts it.
        switchAccount: () => void logout(),
    }
}
