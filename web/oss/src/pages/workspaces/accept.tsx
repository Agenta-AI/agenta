import {useEffect, useRef, useState, type FC} from "react"

import {message} from "@agenta/ui/app-message"
import {Button, Card, Typography} from "antd"
import {getDefaultStore, useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"
import {useLocalStorage} from "usehooks-ts"

import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {normalizeInviteError} from "@/oss/lib/helpers/authMessages"
import {isEE} from "@/oss/lib/helpers/isEE"
import {acceptWorkspaceInvite} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {useProjectData} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"
import {clearInvite} from "@/oss/state/url/auth"
import {buildPostLoginPath} from "@/oss/state/url/postLoginRedirect"
import {activeInviteAtom} from "@/oss/state/url/test"

const processedTokens = new Set<string>()

const Accept: FC = () => {
    const [invite] = useLocalStorage<any>("invite", {})
    const inviteFromState = useAtomValue(activeInviteAtom)
    const {refetch: refetchOrganization, loading: _loadingOrgs} = useOrgData()
    const {refetch: refetchProject, isLoading: _loadingProjects} = useProjectData()
    const router = useRouter()
    const accept = useRef(false)
    const [error, setError] = useState<string | null>(null)

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
                    clearInvite()
                    if (isSurvey) {
                        const redirect = encodeURIComponent(`/w/${targetWorkspace}`)
                        const targetPath = isEE()
                            ? `/post-signup?redirect=${redirect}`
                            : `/get-started?redirect=${redirect}`
                        await router.replace(targetPath)
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
                } catch (error: any) {
                    const status = error?.response?.status
                    const detailObj = error?.response?.data?.detail
                    const code = typeof detailObj === "object" ? detailObj?.error : undefined

                    // INVITE_ALREADY_ACCEPTED (409): OSS consumes the invite at
                    // signup, so a re-accept by this same user is success, not failure.
                    if (status === 409 || code === "INVITE_ALREADY_ACCEPTED") {
                        message.success("Joined workspace!")
                        const targetWorkspace = workspaceId || organizationId
                        cacheWorkspaceOrgPair(targetWorkspace, organizationId)
                        clearInvite()

                        const nextPath = buildPostLoginPath({
                            workspaceId: targetWorkspace,
                            projectId,
                        })
                        await router.replace(nextPath)
                    } else {
                        // Genuine failure (not found / expired): show the error card.
                        const detailRaw =
                            (typeof detailObj === "object" ? detailObj?.message : detailObj) ||
                            (error?.message as string | undefined) ||
                            "Failed to accept invite"
                        const errorMessage = normalizeInviteError(detailRaw)

                        console.error("[invite] accept failed", error)
                        clearInvite()
                        setError(errorMessage)
                    }
                }
            } catch (error: any) {
                // Treat idempotent scenarios (already a member / already accepted) as success
                const detailObj = error?.response?.data?.detail
                const code = typeof detailObj === "object" ? detailObj?.error : undefined
                const alreadyMember =
                    error?.response?.status === 409 ||
                    code === "INVITE_ALREADY_ACCEPTED" ||
                    /already a member/i.test(error?.message || "")

                const detailRaw =
                    (typeof detailObj === "object" ? detailObj?.message : detailObj) ||
                    (error?.message as string | undefined) ||
                    "Failed to accept invite"
                const detailMessage = normalizeInviteError(
                    detailRaw,
                    "We couldn't finish joining this workspace, but you may already be a member.",
                )

                if (alreadyMember) {
                    message.info("You are already a member of this workspace")
                    cacheWorkspaceOrgPair(workspaceId || organizationId, organizationId)
                } else {
                    console.error("[invite] accept failed", error)
                    message.error(detailMessage)
                }

                clearInvite()
                if (isSurvey) {
                    const redirect = encodeURIComponent(`/w/${workspaceId || organizationId || ""}`)
                    const targetPath = isEE()
                        ? `/post-signup?redirect=${redirect}`
                        : `/get-started?redirect=${redirect}`
                    await router.replace(targetPath)
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

    if (error) {
        const handleSignInDifferentAccount = async () => {
            clearInvite()
            try {
                await signOut()
            } catch {
                // ignore sign out errors
            }
            router.replace("/auth")
        }

        const handleGoBack = () => {
            clearInvite()
            router.replace("/w")
        }

        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center bg-[var(--ag-c-F5F7FA)]">
                <Card className="max-w-[520px] w-[90%] text-center">
                    <Typography.Title level={3} className="!mb-2">
                        Unable to accept invitation
                    </Typography.Title>
                    <Typography.Paragraph className="text-[var(--ag-c-586673)] !mb-6">
                        {error}
                    </Typography.Paragraph>
                    <div className="flex gap-3 justify-center flex-wrap">
                        <Button onClick={handleGoBack}>Go back to your workspaces</Button>
                        <Button type="primary" onClick={handleSignInDifferentAccount}>
                            Sign in with a different account
                        </Button>
                    </div>
                </Card>
            </main>
        )
    }

    return <ContentSpinner />
}

export default () => <Accept />
