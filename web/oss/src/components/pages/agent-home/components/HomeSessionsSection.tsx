import SessionListCard from "@/oss/components/pages/sessions/components/SessionListCard"
import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

/** Your own conversations — pinned first, then recent. Automation runs are a separate list. */
const HomeSessionsSection = ({limit}: {limit?: number} = {}) => (
    <SessionListCard
        withPinned
        policy={sessionListPolicies.homeHuman}
        limit={limit}
        minHeightClassName="min-h-[220px]"
        title="Sessions"
        emptyText="Your conversations will show up here."
    />
)

export default HomeSessionsSection
