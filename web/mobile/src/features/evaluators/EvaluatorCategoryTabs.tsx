import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {ChartDonutIcon, ListChecksIcon} from "@phosphor-icons/react"

import {EVALUATOR_CATEGORIES, isEvaluatorCategory} from "./evaluatorsView"

const ICONS = {automatic: ChartDonutIcon, human: ListChecksIcon} as const

/** Automatic and human evaluators: two lists, one tab each. */
export const EvaluatorCategoryTabs = ({
    category,
    onChange,
}: {
    category: EvaluatorCategory
    onChange: (category: EvaluatorCategory) => void
}) => (
    <Tabs
        value={category}
        onValueChange={(next) => {
            if (isEvaluatorCategory(next)) onChange(next)
        }}
    >
        <TabsList>
            {EVALUATOR_CATEGORIES.map(({key, label}) => {
                const Icon = ICONS[key]
                return (
                    <TabsTrigger key={key} value={key}>
                        <Icon aria-hidden />
                        {label}
                    </TabsTrigger>
                )
            })}
        </TabsList>
    </Tabs>
)
