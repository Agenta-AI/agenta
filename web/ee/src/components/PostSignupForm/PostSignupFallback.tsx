import {ArrowRight} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useRouter} from "next/router"

import type {Org} from "@/oss/lib/Types"

import type {PostSignupFallbackReason} from "./hooks/usePostSignupReadiness"
import PostSignupHeader from "./PostSignupHeader"

interface PostSignupFallbackProps {
    orgs: Org[]
    reason: PostSignupFallbackReason
}

const FALLBACK_MESSAGE =
    "We couldn't load the welcome questionnaire right now. You can continue to your workspace and we'll skip this step."

const REASON_MESSAGES: Record<PostSignupFallbackReason, string> = {
    "posthog-load-failed": FALLBACK_MESSAGE,
    "survey-fetch-error": FALLBACK_MESSAGE,
    "watchdog-timeout": FALLBACK_MESSAGE,
}

/**
 * Shown when an onboarding-survey dependency fails transiently (network,
 * analytics blocked, PostHog asset CDN down). We surface a single, calm message
 * with one action: continue to /get-started. The user understands they're
 * being moved on; no silent redirect, no infinite spinner.
 */
const PostSignupFallback = ({orgs, reason}: PostSignupFallbackProps) => {
    const router = useRouter()

    return (
        <>
            <PostSignupHeader orgs={orgs} />
            <div className="w-[400px] mx-auto mt-12 flex flex-col gap-6 text-center">
                <Typography.Title level={3} className="!mb-0">
                    Welcome to Agenta
                </Typography.Title>
                <Typography.Paragraph className="!mb-0">
                    {REASON_MESSAGES[reason]}
                </Typography.Paragraph>
                <Button
                    type="primary"
                    size="large"
                    iconPlacement="end"
                    icon={<ArrowRight className="mt-[3px]" />}
                    onClick={() => router.push("/get-started")}
                >
                    Continue
                </Button>
            </div>
        </>
    )
}

export default PostSignupFallback
