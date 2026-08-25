import type {AgentSetupSelection} from "@agenta/entities/workflow"
import {AgentSetupCard, type AgentSetupStep} from "@agenta/entity-ui/onboarding"

import {FIRST_RUN_COPY} from "./copy"

/**
 * First run, after the description: connect the accounts the agent will need before it exists
 * (#6043), instead of letting the builder ask for them mid-run one turn at a time.
 *
 * Replaces the composer in place rather than opening a sheet — on a phone a sheet over a screen
 * that is already one column just hides the thing you are describing. The description stays on
 * top, editable, so this reads as the same act continuing.
 */
export const FirstRunSetupStep = ({
    step,
    creating,
    onCreate,
    onEdit,
}: {
    step: AgentSetupStep
    creating: boolean
    onCreate: (selection: AgentSetupSelection) => void
    onEdit: () => void
}) => {
    return (
        <div className="flex flex-col gap-3">
            <div className="border-border bg-card flex items-start gap-3 rounded-xl border border-solid p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">
                        {FIRST_RUN_COPY.buildingLabel}
                    </span>
                    <span className="text-sm leading-snug">{step.draft?.seedMessage}</span>
                </div>
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={creating}
                    className="border-border text-muted-foreground hover:border-primary hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 box-border shrink-0 cursor-pointer rounded-full border border-solid bg-transparent px-3 py-1 text-xs outline-none transition-colors focus-visible:ring-[3px] disabled:opacity-50"
                >
                    {FIRST_RUN_COPY.editLabel}
                </button>
            </div>

            <AgentSetupCard
                accounts={step.accounts}
                suggestions={step.suggestions}
                skippedSlugs={step.skippedSlugs}
                onSkip={step.skip}
                onUndoSkip={step.undoSkip}
                onAddAccount={step.addAccount}
                permission={step.permission}
                onPermissionChange={step.setPermission}
                onCreate={onCreate}
                creating={creating}
            />
        </div>
    )
}
