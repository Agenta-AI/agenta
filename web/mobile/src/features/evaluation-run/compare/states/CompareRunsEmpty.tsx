/** The old app's empty picker: no other run shares a test set and an evaluator with this one. */
export const CompareRunsEmpty = () => (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <p className="m-0 text-title text-foreground">No evaluations to compare</p>
        <p className="m-0 max-w-70 text-body text-muted-foreground">
            Run another evaluation using the same test set to enable comparison.
        </p>
    </div>
)
