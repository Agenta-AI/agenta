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
import {buildPostLoginPath} from "@/oss/state/url/postLoginRedirect"
import {activeInviteAtom} from "@/oss/state/url/test"

const processedTokens = new Set<string>()

const Accept: FC = () => {
    const [invite, , removeInvite] = useLocalStorage<any>("invite", {})
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
                    store.set(activeInviteAtom, null)
                    removeInvite()
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
                        // Show error state instead of staying stuck on loading
                        const detailRaw =
                            (error?.response?.data?.detail as string | undefined) ||
                            (error?.message as string | undefined) ||
                            "Failed to accept invite"
                        const errorMessage = normalizeInviteError(detailRaw)

                        console.error("[invite] accept failed", error)
                        store.set(activeInviteAtom, null)
                        removeInvite()
                        setError(errorMessage)
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

                store.set(activeInviteAtom, null)
                removeInvite()
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
            try {
                await signOut()
            } catch {
                // ignore sign out errors
            }
            router.replace("/auth")
        }

        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center bg-[#f5f7fa]">
                <Card className="max-w-[520px] w-[90%] text-center">
                    <Typography.Title level={3} className="!mb-2">
                        Unable to accept invitation
                    </Typography.Title>
                    <Typography.Paragraph className="text-[#586673] !mb-6">
                        {error}
                    </Typography.Paragraph>
                    <div className="flex gap-3 justify-center flex-wrap">
                        <Button onClick={() => router.replace("/w")}>
                            Go back to your workspaces
                        </Button>
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
