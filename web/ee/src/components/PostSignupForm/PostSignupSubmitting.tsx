import {Spin} from "antd"

import type {Org} from "@/oss/lib/Types"

import PostSignupHeader from "./PostSignupHeader"

interface PostSignupSubmittingProps {
    orgs: Org[]
}

/**
 * Full-page state shown between the user clicking Submit and Next.js
 * completing the route change to /get-started. Replaces the form entirely
 * (rather than overlaying it) so the transition is unambiguous and doesn't
 * depend on antd Spin's overlay positioning. Combined with router.prefetch
 * on the gate component, the navigation should land before the user wonders
 * what's happening — but if it doesn't, the user sees a clear "we got it,
 * setting things up" message rather than a blank screen.
 */
const PostSignupSubmitting = ({orgs}: PostSignupSubmittingProps) => {
    return (
        <>
            <PostSignupHeader orgs={orgs} />
            <div className="w-[400px] mx-auto mt-16 flex flex-col items-center gap-6 text-center">
                <Spin size="large" />
                <div className="space-y-1">
                    <h3 className="!mb-0 text-lg font-semibold leading-snug">
                        Setting up your workspace
                    </h3>
                    <p className="!mb-0 text-muted-foreground">This will only take a moment.</p>
                </div>
            </div>
        </>
    )
}

export default PostSignupSubmitting
