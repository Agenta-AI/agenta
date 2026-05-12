import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useRouter} from "next/router"

import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"

import type {ArchivedEntityLayoutProps} from "./types"

export default function ArchivedEntityLayout({
    title,
    subtitle,
    onBack,
    isEmpty = false,
    children,
}: ArchivedEntityLayoutProps) {
    const router = useRouter()
    const handleBack = onBack ?? (() => router.back())
    const entityLabel = title
        .replace(/^Archived\s+/i, "")
        .trim()
        .toLowerCase()
    const emptyTitle = entityLabel ? `No archived ${entityLabel}` : "No archived items"

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
                <Button
                    type="text"
                    icon={<ArrowLeft size={16} />}
                    onClick={handleBack}
                    className="self-start"
                >
                    Back
                </Button>
                <div className="flex flex-col gap-1">
                    <Typography.Text className="!my-0 text-lg font-semibold">
                        {title}
                    </Typography.Text>
                    {subtitle ? (
                        <Typography.Text type="secondary">{subtitle}</Typography.Text>
                    ) : null}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {isEmpty ? (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white">
                        <EmptyComponent
                            description={
                                <div className="flex flex-col gap-2">
                                    <Typography.Text className="text-lg font-medium">
                                        {emptyTitle}
                                    </Typography.Text>
                                    <Typography.Text type="secondary">
                                        Archived items will appear here and can be restored later.
                                    </Typography.Text>
                                </div>
                            }
                        />
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    )
}
