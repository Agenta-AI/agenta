import {Button} from "@agenta/ui/ui"
import {AlertCircle} from "lucide-react"

import {ContentRail} from "@/components/ContentRail"

export const PendingTaskError = ({
    failureReason,
    filenames = [],
    retryDisabled,
    onRetry,
}: {
    failureReason?: string
    filenames?: string[]
    retryDisabled: boolean
    onRetry: () => void
}) => (
    <div className="bg-background px-3 pt-2">
        <ContentRail>
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-colorErrorBorder bg-colorErrorBg px-3 py-2.5 sm:flex-row sm:items-start">
                <div role="alert" className="flex min-w-0 flex-1 items-start gap-2">
                    <AlertCircle
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-colorErrorText"
                    />
                    <div className="min-w-0 space-y-1 text-xs">
                        <p className="font-medium text-colorErrorText">Message not sent</p>
                        {failureReason ? (
                            <p className="break-words text-colorErrorText [overflow-wrap:anywhere]">
                                {failureReason}
                            </p>
                        ) : null}
                        <p className="text-muted-foreground">
                            Your text and attachments are saved.
                        </p>
                        {filenames.length > 0 ? (
                            <ul aria-label="Saved attachments" className="space-y-1">
                                {filenames.map((filename, index) => (
                                    <li
                                        key={`${filename}-${index}`}
                                        className="break-words text-muted-foreground [overflow-wrap:anywhere]"
                                    >
                                        {filename || "Attachment"}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 self-start"
                    disabled={retryDisabled}
                    onClick={onRetry}
                >
                    Retry message
                </Button>
            </div>
        </ContentRail>
    </div>
)
