import SessionListCard from "@/oss/components/pages/sessions/components/SessionListCard"

/** Your own conversations — pinned first, then recent. Automation runs are a separate list. */
const HomeSessionsSection = ({limit}: {limit?: number} = {}) => (
    <SessionListCard
        withPinned
        limit={limit}
        title="Sessions"
        emptyText="Your conversations will show up here."
    />
)

export default HomeSessionsSection
