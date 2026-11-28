/** The Raw view of a drawer tab: its part of the test case as one read-only JSON document. */
export const ScenarioPayloadView = ({payload, label}: {payload: string; label: string}) => (
    <pre
        aria-label={label}
        className="m-0 whitespace-pre-wrap break-words rounded-md border border-solid border-border bg-card p-3 text-code"
    >
        {payload}
    </pre>
)
