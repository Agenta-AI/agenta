/** A centered note where the scenario content would be: no data, a failed load, nothing picked. */
export const ScenarioMessage = ({title, detail}: {title: string; detail?: string}) => (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-4 py-10 text-center">
        <span
            className={
                detail ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"
            }
        >
            {title}
        </span>
        {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
    </div>
)
