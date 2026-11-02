import {formatScenarioValue, isComplexScenarioValue} from "@agenta/annotation"

/** One test case field: its key, then its value (objects as pretty JSON). */
export const ScenarioFieldCard = ({name, value}: {name: string; value: unknown}) => (
    <section className="flex flex-col gap-1.5 rounded-lg border border-solid border-border bg-card p-3">
        <h3 className="m-0 text-xs font-medium text-muted-foreground">{name}</h3>
        {isComplexScenarioValue(value) ? (
            <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs text-foreground">
                {formatScenarioValue(value)}
            </pre>
        ) : (
            <p className="m-0 whitespace-pre-wrap break-words text-sm text-foreground">
                {formatScenarioValue(value)}
            </p>
        )}
    </section>
)
