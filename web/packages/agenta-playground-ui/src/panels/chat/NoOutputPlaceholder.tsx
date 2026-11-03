import {Play} from "@phosphor-icons/react"

/** The last turn has no reply yet. */
export const NoOutputPlaceholder = () => (
    <div className="w-full rounded-md px-3 py-2.5">
        <div className="flex items-start gap-2">
            <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Play size={12} />
            </div>
            <div className="min-w-0">
                <p className="m-0 text-xs font-medium leading-4 text-foreground">No output yet</p>
                <p className="m-0 mt-0.5 text-xs leading-4 text-muted-foreground">
                    Click Run (Ctrl+Enter / ⌘+Enter) to generate output.
                </p>
            </div>
        </div>
    </div>
)
