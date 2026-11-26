import {SESSION_TABS, type SessionView} from "@agenta/annotation"
import {useMediaQuery} from "@agenta/ui/hooks"
import {Segmented, Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"

const WIDE_QUERY = "(min-width: 640px)"

const SEGMENTED_OPTIONS = SESSION_TABS.map((tab) => ({value: tab.key, label: tab.label}))

/** Annotate, All Annotations and Configuration: tabs on a wide screen, a segmented control on a phone. */
export const QueueSessionTabs = ({
    view,
    onChange,
}: {
    view: SessionView
    onChange: (view: SessionView) => void
}) => {
    const wide = useMediaQuery(WIDE_QUERY)
    if (!wide) {
        return (
            <Segmented
                block
                size="sm"
                aria-label="Queue views"
                options={SEGMENTED_OPTIONS}
                value={view}
                onChange={(next) => onChange(next as SessionView)}
            />
        )
    }
    return (
        <Tabs value={view} onValueChange={(next) => onChange(next as SessionView)}>
            <TabsList aria-label="Queue views">
                {SESSION_TABS.map((tab) => (
                    <TabsTrigger key={tab.key} value={tab.key}>
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    )
}
