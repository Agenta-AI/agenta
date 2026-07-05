import React from "react"

import {MenuProps} from "antd"

import {UserReference} from "@/oss/components/References/UserReference"

export interface RevisionOption {
    id: string
    version: number
    created_at?: string | null
    message?: string | null
    author?: string | null
}

export const buildRevisionMenuItems = (
    revisions: RevisionOption[],
    onSelect?: (revisionId: string) => void,
): MenuProps["items"] => {
    return (
        revisions
            // Filter out v0 revisions - they are placeholders and should not be displayed
            .filter((revision) => revision.version > 0)
            .sort((a, b) => b.version - a.version)
            .map((revision) => ({
                key: revision.id,
                label: (
                    <div className="flex flex-col gap-0.5 py-1 max-w-[240px]">
                        <div className="flex items-center gap-2">
                            <span className="font-medium">v{revision.version}</span>
                            {revision.created_at && (
                                <span className="text-xs text-muted-foreground">
                                    {new Date(revision.created_at).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                        {revision.message && (
                            <span
                                className="text-xs truncate max-w-[220px] text-muted-foreground"
                                title={revision.message}
                            >
                                {revision.message}
                            </span>
                        )}
                        {revision.author && (
                            <div className="text-xs">
                                <UserReference userId={revision.author} />
                            </div>
                        )}
                    </div>
                ),
                onClick: onSelect ? () => onSelect(revision.id) : undefined,
            }))
    )
}
