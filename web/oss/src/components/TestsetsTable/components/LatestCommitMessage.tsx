import {memo, useEffect} from "react"

import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {latestRevisionAtomFamily, requestLatestRevisionAtom} from "../atoms/latestRevisionStore"

interface LatestCommitMessageProps {
    testsetId: string
}

/**
 * Displays the latest revision commit message for a testset.
 * Uses batched fetching for performance - multiple instances will
 * batch their requests into a single API call.
 */
const LatestCommitMessage = ({testsetId}: LatestCommitMessageProps) => {
    const requestLatestRevision = useSetAtom(requestLatestRevisionAtom)
    const latestRevision = useAtomValue(latestRevisionAtomFamily(testsetId))

    // Request the latest revision on mount
    useEffect(() => {
        if (testsetId) {
            requestLatestRevision(testsetId)
        }
    }, [testsetId, requestLatestRevision])

    if (!latestRevision) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <Typography.Text ellipsis title={latestRevision.message || "No message"}>
            {latestRevision.message || "—"}
        </Typography.Text>
    )
}

export default memo(LatestCommitMessage)
