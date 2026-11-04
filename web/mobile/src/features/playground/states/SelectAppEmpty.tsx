import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {AppPicker} from "@agenta/playground-ui/panels/evaluator"
import {AppWindow} from "@phosphor-icons/react"

/**
 * The run pane in "Run on an app output" mode before an app is connected: the evaluator cannot
 * run yet, so the pane offers the one step that unblocks it.
 */
export const SelectAppEmpty = ({
    onSelect,
}: {
    onSelect: (app: WorkflowRevisionSelectionResult) => void
}) => (
    <div className="flex h-full items-center justify-center px-4 py-10">
        <div className="flex max-w-[340px] flex-col items-center gap-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <AppWindow aria-hidden size={26} />
            </span>
            <div className="flex flex-col gap-1">
                <p className="m-0 text-base font-semibold text-foreground">
                    Select an app to run the evaluator on
                </p>
                <p className="m-0 text-[13px] leading-snug text-muted-foreground">
                    The evaluator grades this app&apos;s output. Pick which app to run, then fill
                    its inputs or load a test set.
                </p>
            </div>
            <AppPicker selectedLabel={null} onSelect={onSelect} size="default" />
        </div>
    </div>
)
