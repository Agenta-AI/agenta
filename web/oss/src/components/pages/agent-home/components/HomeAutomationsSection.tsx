import HomeSessionList from "./HomeSessionList"

/**
 * What the automations actually did — the sessions they produced, not a schedule of what's next.
 * A completed run can need attention; an upcoming one never does.
 *
 * These are sessions like any other, so they open and act exactly like the ones you started; they
 * are only separated out because they aren't your own work.
 */
const HomeAutomationsSection = () => (
    <HomeSessionList
        origin="trigger"
        title="Automation runs"
        emptyText="Runs from your automations will show up here."
        limit={5}
    />
)

export default HomeAutomationsSection
