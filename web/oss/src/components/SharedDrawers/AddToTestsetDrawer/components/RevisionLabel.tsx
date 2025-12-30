import {Typography} from "antd"

import {UserReference} from "@/oss/components/References/UserReference"
import type {Revision as TestsetRevision} from "@/oss/state/entities/testset"

/**
 * Build a rich revision label for cascader dropdown
 * Shows version, date, commit message, and author
 */
export function buildRevisionLabel(revision: TestsetRevision): React.ReactNode {
    return (
        <div className="flex flex-col gap-0.5 py-1 max-w-[240px]">
            <div className="flex items-center gap-2">
                <span className="font-medium">v{revision.version}</span>
                {revision.created_at && (
                    <Typography.Text type="secondary" className="text-xs">
                        {new Date(revision.created_at).toLocaleDateString()}
                    </Typography.Text>
                )}
            </div>
            {revision.message && (
                <Typography.Text
                    type="secondary"
                    className="text-xs truncate max-w-[220px]"
                    title={revision.message}
                >
                    {revision.message}
                </Typography.Text>
            )}
            {revision.created_by_id && (
                <div className="text-xs">
                    <UserReference userId={revision.created_by_id} />
                </div>
            )}
        </div>
    )
}

/**
 * Build selected revision label for cascader display (input field)
 * Shows testset name with version in a gray box
 */
export function buildSelectedRevisionLabel(
    testsetName: string,
    version: number | string,
): React.ReactNode {
    return (
        <span className="flex items-center gap-2">
            <span>{testsetName}</span>
            <span className="px-1.5 py-0.5 bg-[#f0f0f0] rounded text-xs font-medium">
                v{version}
            </span>
        </span>
    )
}
