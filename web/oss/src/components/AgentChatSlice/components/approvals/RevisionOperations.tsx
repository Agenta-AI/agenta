/**
 * The ordered `operations` of a commit, as the approval card shows them.
 *
 * Old text sits beside new text as two labelled blocks rather than a computed unified diff. The
 * runner produces a real diff only for content it froze from the workspace, and that one renders
 * through `ApprovedContentManifest`. Everything here comes straight from the payload, so the card
 * never implies a diff it did not compute. See `operationsPreview.ts` for why nothing is applied.
 */
import {operationLabel, type RevisionOperationPreview} from "./operationsPreview"

const TextBlock = ({label, text, tone}: {label: string; text: string; tone: "old" | "new"}) => (
    <div className="flex min-w-0 flex-col gap-1">
        <div className="text-[11px] font-medium text-colorTextTertiary">{label}</div>
        <pre
            className={`m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-solid border-colorBorderSecondary bg-colorBgContainer p-2 font-mono text-[11px] leading-snug ${
                tone === "old" ? "text-colorTextTertiary" : "text-colorText"
            }`}
        >
            {text}
        </pre>
    </div>
)

const OperationCard = ({operation}: {operation: RevisionOperationPreview}) => (
    <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-semibold text-colorText">
                {operationLabel(operation.operation)} {operation.targetLabel}
            </span>
            {operation.fromFile ? (
                <span className="text-[11px] text-colorTextTertiary">from your workspace</span>
            ) : null}
            {operation.editCount ? (
                <span className="text-[11px] text-colorTextTertiary">
                    {operation.editCount} {operation.editCount === 1 ? "edit" : "edits"}
                </span>
            ) : null}
        </div>

        {operation.oldText !== undefined ? (
            <TextBlock label="Now" text={operation.oldText} tone="old" />
        ) : null}
        {operation.newText !== undefined ? (
            <TextBlock
                label={operation.oldText === undefined ? "New value" : "After"}
                text={operation.newText}
                tone="new"
            />
        ) : null}
        {operation.valueJson !== undefined ? (
            <TextBlock label="New value" text={operation.valueJson} tone="new" />
        ) : null}

        {/* Saying so is the point: an absent old side must never read as "nothing was there". */}
        {operation.newText !== undefined && operation.oldText === undefined ? (
            <div className="text-[11px] text-colorTextTertiary">
                The current value is not shown here, so compare against the agent&apos;s
                configuration if you need the exact before.
            </div>
        ) : null}
    </div>
)

const RevisionOperations = ({operations}: {operations: RevisionOperationPreview[]}) => (
    <div className="flex min-w-0 flex-col gap-3">
        <div className="text-xs font-semibold text-colorText">
            What&apos;s changing
            <span className="ml-1.5 font-normal text-colorTextTertiary">
                {operations.length} {operations.length === 1 ? "change" : "changes"}
            </span>
        </div>
        {operations.map((operation) => (
            <OperationCard key={operation.index} operation={operation} />
        ))}
    </div>
)

export default RevisionOperations
