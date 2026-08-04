import {Alert, Button} from "antd"
import {useAtomValue} from "jotai"

import {driveEditBufferAtom} from "../state"

export function DriveEditBanner({
    onRetry,
    onReload,
    onOverwrite,
}: {
    onRetry: () => void
    onReload: () => void
    onOverwrite: () => void
}) {
    const buffer = useAtomValue(driveEditBufferAtom)
    const issue = buffer?.issue

    if (!buffer || !issue) return null

    if (issue.kind === "error") {
        return (
            <Alert
                showIcon
                type="error"
                message={`${issue.message}. Your changes are still here.`}
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
            ? `${buffer.displayPath} was deleted while you were editing. Overwriting will recreate it.`
            : `${buffer.displayPath} changed while you were editing. Overwriting will replace that version.`

    return (
        <Alert
            showIcon
            type="warning"
            message={message}
            action={
                <div className="flex items-center gap-2">
                    <Button size="small" onClick={onReload}>
                        Reload from disk
                    </Button>
                    <Button size="small" type="primary" onClick={onOverwrite}>
                        Overwrite
                    </Button>
                </div>
            }
            className="shrink-0 rounded-none border-x-0 border-t-0"
        />
    )
}
