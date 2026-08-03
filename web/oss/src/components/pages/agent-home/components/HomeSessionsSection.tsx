import HomeSessionList from "./HomeSessionList"

/** Your own conversations — pinned first, then recent. Automation runs are a separate list. */
const HomeSessionsSection = () => (
    <HomeSessionList
        withPinned
        title="Sessions"
        emptyText="Your conversations will show up here."
    />
)

export default HomeSessionsSection
