import SessionListCard from "@/oss/components/pages/sessions/components/SessionListCard"

/**
 * What the automations actually did — the sessions they produced, not a schedule of what's next.
 * A completed run can need attention; an upcoming one never does.
 *
 * These are sessions like any other, so they open and act exactly like the ones you started; they
 * are only separated out because they aren't your own work.
 */
const HomeAutomationsSection = () => (
    <SessionListCard
        // Pinned runs lead here too. The pinned query carries `origin`, so it stays this card's
        // own set — the Sessions card still excludes trigger-origin sessions from its group.
        withPinned
        origin="trigger"
        title="Automation runs"
        emptyText="Runs from your automations will show up here."
        limit={5}
        // Barely above the empty state's own height: a taller floor on a one-row card leaves a
        // block of dead space that reads as a rendering failure rather than a short list.
        minHeightClassName="min-h-[100px]"
    />
)

export default HomeAutomationsSection
