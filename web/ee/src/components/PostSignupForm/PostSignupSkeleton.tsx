import type {Org} from "@agenta/entities/organization"
import {Spin} from "antd"

import PostSignupHeader from "./PostSignupHeader"

interface PostSignupSkeletonProps {
    orgs: Org[]
}

const PostSignupSkeleton = ({orgs}: PostSignupSkeletonProps) => {
    return (
        <>
            <PostSignupHeader orgs={orgs} />
            <div className="flex items-center justify-center w-full mt-24">
                <Spin spinning size="large" />
            </div>
        </>
    )
}

export default PostSignupSkeleton
