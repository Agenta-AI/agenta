import {useEffect, useState} from "react"

import {Button} from "antd"
import {useRouter} from "next/router"

import {useOrgData} from "@/oss/state/org"
import {
    buildPostLoginPathResolved,
    waitForWorkspaceContext,
} from "@/oss/state/url/postLoginRedirect"

import PostSignupSkeleton from "./PostSignupSkeleton"

// Role and referral now live in the shared, project-scoped onboarding flow.
const PostSignupRoute = () => {
    const router = useRouter()
    const {orgs} = useOrgData()
    const [attempt, setAttempt] = useState(0)
    const [error, setError] = useState(false)
    useEffect(() => {
        let mounted = true
        setError(false)
        void (async () => {
            try {
                const context = await waitForWorkspaceContext({requireProjectId: false})
                const path = await buildPostLoginPathResolved(context)
                if (mounted) await router.replace(path)
            } catch {
                if (mounted) setError(true)
            }
        })()
        return () => {
            mounted = false
        }
    }, [router, attempt])
    if (error)
        return (
            <div role="alert" className="p-8">
                Couldn't open your workspace.{" "}
                <Button onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
            </div>
        )
    return <PostSignupSkeleton orgs={orgs ?? []} />
}

export default PostSignupRoute
