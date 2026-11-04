import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {ChartDonut, Code, Lightning, ListChecks} from "@phosphor-icons/react"

import {KIND_TABS, type EvaluationKindTab} from "./useEvaluationRunsFilters"

const TAB_LABEL: Record<EvaluationKindTab, string> = {
    all: "All Evals",
    auto: "Auto Evals",
    human: "Human Evals",
    online: "Live Evals",
    custom: "SDK Evals",
}

const TAB_ICON: Record<EvaluationKindTab, typeof Code | null> = {
    all: null,
    auto: ChartDonut,
    human: ListChecks,
    online: Lightning,
    custom: Code,
}

/** The kind tabs. App scope has no Live tab. On a phone the row scrolls sideways. */
export const EvaluationKindTabs = ({
    value,
    appScoped,
    onChange,
}: {
    value: EvaluationKindTab
    appScoped: boolean
    onChange: (next: EvaluationKindTab) => void
}) => (
    <Tabs
        value={value}
        onValueChange={(next) => {
            const tab = KIND_TABS.find((entry) => entry === next)
            if (tab) onChange(tab)
        }}
        className="max-w-full overflow-x-auto"
    >
        <TabsList>
            {KIND_TABS.filter((tab) => !(appScoped && tab === "online")).map((tab) => {
                const Icon = TAB_ICON[tab]
                return (
                    <TabsTrigger key={tab} value={tab}>
                        {Icon ? <Icon aria-hidden size={14} /> : null}
                        {TAB_LABEL[tab]}
                    </TabsTrigger>
                )
            })}
        </TabsList>
    </Tabs>
)
