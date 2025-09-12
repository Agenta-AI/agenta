import {useEffect, useRef, type FC} from "react"

import {message} from "antd"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import ProtectedRoute from "@/oss/components/ProtectedRoute/ProtectedRoute"
import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {isDemo} from "@/oss/lib/helpers/utils"
import {acceptWorkspaceInvite} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useProjectData} from "@/oss/state/project"

const Accept: FC = () => {
    const [invite, , removeInvite] = useLocalStorage<any>("invite", {})
    const {
        refetch: refetchOrganization,
        changeSelectedOrg,
        orgs,
        loading: loadingOrgs,
    } = useOrgData()
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
        if (!loadingOrgs && !loadingProjects && !accept.current && orgId && token) {
            accept.current = true
            try {
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

                refetchOrganization()
                refetchProject()

                if (orgs.find((item) => item.id === orgId)) {
                    isDemo() && changeSelectedOrg(orgId)
                }

                accept.current = true

                message.success("Joined workspace!")
                if (isSurvey) {
                    await router.push("/post-signup")
                } else {
                    await router.push("/apps")
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
                    await router.push("/post-signup")
                } else {
                    await router.push("/apps")
                }
            } finally {
                removeInvite()
            }
        }
    }

    useEffect(() => {
        onAcceptInvite()
    }, [orgId, loadingOrgs, loadingProjects, accept])

    return <ContentSpinner />
}

export default () => <Accept />
