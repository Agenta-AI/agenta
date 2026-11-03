import {SkeletonBlock} from "@agenta/ui/ui"

import {ConfigSection} from "./ConfigSection"
import {EvaluatorConfigCard} from "./EvaluatorConfigCard"
import type {EvaluatorConfig} from "./useEvaluatorConfigs"

/** The Evaluators section: one collapsible card per evaluator, the first one open. */
export const EvaluatorsConfigSection = ({evaluators}: {evaluators: readonly EvaluatorConfig[]}) => (
    <ConfigSection
        id="config-evaluators"
        title="Evaluators"
        subtitle={
            evaluators.length > 0
                ? `${evaluators.length} ${evaluators.length === 1 ? "evaluator" : "evaluators"}`
                : null
        }
    >
        {evaluators.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">
                No evaluator reference found for this run.
            </p>
        ) : (
            <div className="flex flex-col gap-3">
                {evaluators.map((evaluator, index) =>
                    evaluator.failed ? (
                        <p key={evaluator.key} className="m-0 text-sm text-destructive">
                            Failed to load evaluator details
                        </p>
                    ) : evaluator.pending ? (
                        <SkeletonBlock key={evaluator.key} className="h-16 w-full rounded-md" />
                    ) : (
                        <EvaluatorConfigCard
                            key={evaluator.key}
                            evaluator={evaluator}
                            defaultOpen={index === 0}
                        />
                    ),
                )}
            </div>
        )}
    </ConfigSection>
)
