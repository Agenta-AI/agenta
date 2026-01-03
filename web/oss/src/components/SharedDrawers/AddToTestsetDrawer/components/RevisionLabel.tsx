import {Typography} from "antd"

import {UserReference} from "@/oss/components/References/UserReference"
import type {RevisionListItem} from "@/oss/state/entities/testset"

/**
 * Build a rich revision label for cascader dropdown
 * Shows version, date, commit message, and author
 */
export function buildRevisionLabel(revision: RevisionListItem): React.ReactNode {
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
        <span style={{display: "flex", alignItems: "center", gap: 8, width: "100%"}}>
            <Typography.Text ellipsis style={{flex: "1 1 0", minWidth: 0}}>
                {testsetName}
            </Typography.Text>
            <span
                style={{
                    padding: "2px 6px",
                    backgroundColor: "#f0f0f0",
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    flexShrink: 0,
                }}
            >
                v{version}
            </span>
        </span>
    )
}
