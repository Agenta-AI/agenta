import type {AgentTemplateValidationIssue} from "@agenta/entities/workflow"
import {WarningCircleIcon} from "@phosphor-icons/react"

/** The validator's first finding: what is wrong, where, and how to fix it. */
export const TemplateIssueCard = ({
    label,
    issue,
}: {
    label: string
    issue: AgentTemplateValidationIssue
}) => (
    <div
        role="alert"
        className="box-border flex flex-col gap-3 rounded-lg border border-solid border-destructive/40 bg-destructive/5 p-4"
    >
        <div className="flex items-start gap-2">
            <WarningCircleIcon
                size={18}
                weight="fill"
                className="mt-px shrink-0 text-destructive"
            />
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                    This package can&apos;t be loaded
                </span>
                <span className="truncate text-xs text-muted-foreground">{label}</span>
            </div>
        </div>
        <p className="m-0 text-sm text-foreground">{issue.message}</p>
        {issue.path || issue.field ? (
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {issue.path ? (
                    <>
                        <dt className="text-muted-foreground">File</dt>
                        <dd className="m-0 truncate font-mono text-foreground">{issue.path}</dd>
                    </>
                ) : null}
                {issue.field ? (
                    <>
                        <dt className="text-muted-foreground">Field</dt>
                        <dd className="m-0 truncate font-mono text-foreground">{issue.field}</dd>
                    </>
                ) : null}
            </dl>
        ) : null}
        {issue.next_step ? (
            <div className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">How to fix</span>
                <span className="text-muted-foreground">{issue.next_step}</span>
            </div>
        ) : null}
    </div>
)
