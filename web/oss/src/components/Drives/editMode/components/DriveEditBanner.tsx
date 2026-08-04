import {Alert, Button} from "antd"
import {useAtomValue} from "jotai"

import {driveEditDisplayPathAtomFamily, driveEditIssueAtomFamily} from "../state"

const punctuate = (message: string) => {
    const trimmed = message.trim().replace(/\.{2,}$/, ".")
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

export function DriveEditBanner({
    driveKey,
    onRetry,
    onReload,
    onOverwrite,
}: {
    driveKey: string
    onRetry: () => void
    onReload: () => void
    onOverwrite: () => void
}) {
    const issue = useAtomValue(driveEditIssueAtomFamily(driveKey))
    const displayPath = useAtomValue(driveEditDisplayPathAtomFamily(driveKey))

    if (!issue) return null

    if (issue.kind === "error") {
        return (
            <Alert
                showIcon
                type="error"
                message={`Couldn’t save this file. ${punctuate(issue.message)} Your changes are still here.`}
                action={
                    <Button size="small" onClick={onRetry}>
                        Try again
                    </Button>
                }
                className="shrink-0 rounded-none border-x-0 border-t-0"
            />
        )
    }

    const message =
        issue.reason === "missing"
            ? `${displayPath} was deleted while you were editing. Overwriting will recreate it.`
            : `${displayPath} changed while you were editing. Overwriting will replace that version.`

    return (
        <Alert
            showIcon
            type="warning"
            message={message}
            action={
                <div className="flex items-center gap-2">
                    {issue.reason === "missing" ? null : (
                        <Button size="small" onClick={onReload}>
                            Reload from disk
                        </Button>
                    )}
                    <Button size="small" type="primary" onClick={onOverwrite}>
                        Overwrite
                    </Button>
                </div>
            }
            className="shrink-0 rounded-none border-x-0 border-t-0"
        />
    )
}
