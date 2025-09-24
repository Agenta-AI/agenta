import {useEffect, useRef, type FC} from "react"

import {getDefaultStore} from "jotai"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import {message} from "@/oss/components/AppMessageContext"
import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {acceptWorkspaceInvite} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useProjectData} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"

const Accept: FC = () => {
    const [invite, , removeInvite] = useLocalStorage<any>("invite", {})
    const {refetch: refetchOrganization, loading: loadingOrgs} = useOrgData()
    const {refetch: refetchProject, isLoading: loadingProjects} = useProjectData()
    const router = useRouter()
    const accept = useRef(false)

    const _invite = router.query.token ? router.query : invite
    const token = _invite?.token as string
    const orgId = _invite?.org_id as string
    const projectId = _invite?.project_id as string
    const workspaceId = _invite?.workspace_id as string
    const email = _invite?.email as string
    const isSurvey = Boolean(router.query.survey)

    const onAcceptInvite = async () => {
        if (!accept.current && orgId && token) {
            accept.current = true
            try {
                // Ensure JWT is ready before calling protected API
                const store = getDefaultStore()
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

                await acceptWorkspaceInvite(
                    {
                        token,
                        orgId,
                        workspaceId,
                        projectId,
                        email,
                    },
                    true,
                )

                await refetchOrganization()
                await refetchProject()

                message.success("Joined workspace!")
                // Update selected org id; then navigate explicitly
                store.set(selectedOrgIdAtom, orgId)
                if (isSurvey) {
                    const redirect = encodeURIComponent(`/w/${orgId}`)
                    await router.push(`/post-signup?redirect=${redirect}`)
                } else {
                    await router.push(`/w/${orgId}/p/${projectId}/apps`)
                }
            } catch (error: any) {
                // Treat idempotent scenarios (already a member / already accepted) as success
                const alreadyMember =
                    error?.response?.status === 409 ||
                    /already a member/i.test(error?.response?.data?.detail || "") ||
                    /already a member/i.test(error?.message || "")

                if (alreadyMember) {
                    message.info("You are already a member of this workspace")
                } else {
                    console.error(error)
                }

                if (isSurvey) {
                    const redirect = encodeURIComponent(`/w/${orgId}`)
                    await router.push(`/post-signup?redirect=${redirect}`)
                } else {
                    await router.push("/")
                }
            } finally {
                removeInvite()
            }
        }
    }

    useEffect(() => {
        onAcceptInvite()
        // We only need to react to orgId/token presence; jwt readiness awaited inside
    }, [orgId, token])

    return <ContentSpinner />
}

export default () => <Accept />
