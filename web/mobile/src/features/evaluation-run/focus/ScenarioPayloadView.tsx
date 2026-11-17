/** The JSON view of the drawer: the whole scenario as one read-only JSON document. */
export const ScenarioPayloadView = ({payload}: {payload: string}) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-2">
        <pre
            aria-label="Scenario as JSON"
            className="m-0 whitespace-pre-wrap break-words rounded-md border border-solid border-border bg-card p-3 font-mono text-xs"
        >
            {payload}
        </pre>
    </div>
)
