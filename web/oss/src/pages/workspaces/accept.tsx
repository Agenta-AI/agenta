import {useEffect, useRef, type FC} from "react"

import {getDefaultStore, useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import {message} from "@/oss/components/AppMessageContext"
import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {acceptWorkspaceInvite} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {useProjectData} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"
import {buildPostLoginPath} from "@/oss/state/url/postLoginRedirect"
import {activeInviteAtom} from "@/oss/state/url/test"

const processedTokens = new Set<string>()

const Accept: FC = () => {
    const [invite, , removeInvite] = useLocalStorage<any>("invite", {})
    const inviteFromState = useAtomValue(activeInviteAtom)
    const {refetch: refetchOrganization, loading: loadingOrgs} = useOrgData()
    const {refetch: refetchProject, isLoading: loadingProjects} = useProjectData()
    const router = useRouter()
    const accept = useRef(false)

    const firstString = (value: unknown): string | undefined => {
        if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined
        return typeof value === "string" ? value : undefined
    }

    const source = router.query.token
        ? router.query
        : inviteFromState
          ? {
                token: inviteFromState.token,
                email: inviteFromState.email,
                organization_id: inviteFromState.organization_id,
                workspace_id: inviteFromState.workspace_id,
                project_id: inviteFromState.project_id,
                survey: inviteFromState.survey,
            }
          : invite
    const token = firstString(source?.token) as string | undefined
    const organizationId = firstString(source?.organization_id) as string | undefined
    const projectId = firstString(source?.project_id) as string | undefined
    const workspaceId = firstString(source?.workspace_id) as string | undefined
    const email = firstString(source?.email) as string | undefined
    const isSurvey = Boolean(router.query.survey)

    const onAcceptInvite = async () => {
        if (!organizationId || !token) return
        if (processedTokens.has(token)) return

        if (!accept.current) {
            accept.current = true
            processedTokens.add(token)
            const store = getDefaultStore()
            try {
                await new Promise<void>((resolve) => {
                    let unsub: () => void = () => {}
                    const check = () => {
                        const ready = (store.get(jwtReadyAtom) as any)?.data ?? false
                        if (ready) {
                            unsub()
                            resolve()
                        }
                    }
                    unsub = store.sub(jwtReadyAtom, check)
                    check()
                })

                try {
                    await acceptWorkspaceInvite(
                        {
                            token,
                            organizationId,
                            workspaceId,
                            projectId,
                            email,
                        },
                        true,
                    )

                    message.success("Joined workspace!")

                    await refetchOrganization()
                    await refetchProject()

                    const targetWorkspace = workspaceId || organizationId
                    cacheWorkspaceOrgPair(targetWorkspace, organizationId)
                    store.set(activeInviteAtom, null)
                    removeInvite()
                    if (isSurvey) {
                        const redirect = encodeURIComponent(`/w/${targetWorkspace}`)
                        await router.replace(`/post-signup?redirect=${redirect}`)
                    } else if (targetWorkspace && projectId) {
                        const nextPath = buildPostLoginPath({
                            workspaceId: targetWorkspace,
                            projectId,
                        })
                        await router.replace(nextPath)
                    } else if (targetWorkspace) {
                        const nextPath = buildPostLoginPath({
                            workspaceId: targetWorkspace,
                            projectId: null,
                        })
                        await router.replace(nextPath)
                    } else {
                        await router.replace("/w")
                    }
                } catch (error) {
                    if (error?.response?.status === 409) {
                        message.error("You're already a member of this workspace")
                        const targetWorkspace = workspaceId || organizationId
                        cacheWorkspaceOrgPair(targetWorkspace, organizationId)
                        store.set(activeInviteAtom, null)
                        removeInvite()

                        console.log("Redirect to", {
                            targetWorkspace,
                            projectId,
                            route: `/w/${encodeURIComponent(targetWorkspace)}/p/${encodeURIComponent(projectId)}/apps`,
                        })
                        const nextPath = buildPostLoginPath({
                            workspaceId: targetWorkspace,
                            projectId,
                        })
                        await router.replace(nextPath)
                    } else {
                        message.error("Failed to accept invite")
                        return
                    }
                }
            } catch (error: any) {
                // Treat idempotent scenarios (already a member / already accepted) as success
                const alreadyMember =
                    error?.response?.status === 409 ||
                    /already a member/i.test(error?.response?.data?.detail || "") ||
                    /already a member/i.test(error?.message || "") ||
                    /already accepted/i.test(error?.response?.data?.detail || "")

                const detailRaw =
                    (error?.response?.data?.detail as string | undefined) ||
                    (error?.message as string | undefined) ||
                    "Failed to accept invite"
                const normalizedDetail = detailRaw.trim().toLowerCase()
                const isGenericServerError =
                    normalizedDetail === "an internal error has occurred." ||
                    normalizedDetail === "internal server error"
                const detailMessage = isGenericServerError
                    ? "We couldn't finish joining this workspace, but you may already be a member."
                    : detailRaw

                if (alreadyMember) {
                    message.info("You are already a member of this workspace")
                    cacheWorkspaceOrgPair(workspaceId || organizationId, organizationId)
                } else {
                    console.error("[invite] accept failed", error)
                    message.error(detailMessage)
                }

                store.set(activeInviteAtom, null)
                removeInvite()
                if (isSurvey) {
                    const redirect = encodeURIComponent(`/w/${workspaceId || organizationId || ""}`)
                    await router.replace(`/post-signup?redirect=${redirect}`)
                } else if (workspaceId || organizationId) {
                    const nextPath = buildPostLoginPath({
                        workspaceId: workspaceId || organizationId || null,
                        projectId: null,
                    })
                    await router.replace(nextPath)
                } else {
                    await router.replace("/")
                }
            }
        }
    }

    useEffect(() => {
        onAcceptInvite()
        // We only need to react to organizationId/token presence; jwt readiness awaited inside
    }, [organizationId, token])

    return <ContentSpinner />
}

export default () => <Accept />
