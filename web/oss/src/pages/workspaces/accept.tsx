import {useEffect, useRef, type FC} from "react"

import {message} from "antd"
import {useRouter} from "next/router"

import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {useOrgData} from "@/oss/contexts/org.context"
import {useProjectData} from "@/oss/contexts/project.context"
import {isDemo} from "@/oss/lib/helpers/utils"
import {acceptWorkspaceInvite} from "@/oss/services/workspace/api"

const Accept: FC = () => {
    const router = useRouter()
    const token = router.query.token as string
    const orgId = router.query.org_id as string
    const projectId = router.query.project_id as string
    const workspaceId = router.query.workspace_id as string
    const email = router.query.email as string
    const {refetch: refetchOrganization, changeSelectedOrg, orgs} = useOrgData()
    const accepted = useRef(false)
    const called = useRef(false)

    const {refetch: refetchProject} = useProjectData()

    useEffect(() => {
        if (token && orgId && !called.current) {
            called.current = true
            acceptWorkspaceInvite({token, orgId, workspaceId, projectId, email})
                .then(() => {
                    if (!isDemo()) {
                        router.push("/auth")
                    }
                })
                .then(() => isDemo() && refetchOrganization())
                .then(() => isDemo() && refetchProject())
                .then(() => {
                    accepted.current = true
                })
                .catch(() => {
                    if (!isDemo()) {
                        router.push("/auth")
                    } else {
                        router.push("/apps")
                    }
                })
        }
    }, [token, orgId, email])

    useEffect(() => {
        if (accepted.current && orgs.find((item) => item.id === orgId)) {
            isDemo() && changeSelectedOrg(orgId)
            message.success("Joined workspace!")
            if (!isDemo()) {
                router.push("/auth")
            } else {
                router.push("/apps")
            }
        }
    }, [orgs, orgId])

    return <ContentSpinner />
}

export default Accept
