import {PageTitle} from "@/components/PageTitle"
import {InviteAcceptScreen} from "@/features/invite/InviteAcceptScreen"

// Thin shell: accepts the invite the sign-in page kept, then opens the invited project.
export default function Invite() {
    return (
        <>
            <PageTitle title="Accept invitation" />
            <InviteAcceptScreen />
        </>
    )
}
