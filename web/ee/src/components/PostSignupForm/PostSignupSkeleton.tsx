import {Spinner} from "@agenta/primitive-ui/components/spinner"

import type {Org} from "@/oss/lib/Types"

import PostSignupHeader from "./PostSignupHeader"

interface PostSignupSkeletonProps {
    orgs: Org[]
}

const PostSignupSkeleton = ({orgs}: PostSignupSkeletonProps) => {
    return (
        <>
            <PostSignupHeader orgs={orgs} />
            <div className="flex items-center justify-center w-full mt-24">
                <Spinner className="size-6" />
            </div>
        </>
    )
}

export default PostSignupSkeleton
