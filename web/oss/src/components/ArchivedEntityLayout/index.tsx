import {Button} from "@agenta/primitive-ui/components/button"
import {ArrowLeft} from "@phosphor-icons/react"
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
                <Button onClick={handleBack} className="self-start" variant="ghost">
                    {<ArrowLeft size={16} />}
                    Back
                </Button>
                <div className="flex flex-col gap-1">
                    <span className="!my-0 text-lg font-semibold">{title}</span>
                    {subtitle ? <span className="text-muted-foreground">{subtitle}</span> : null}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {isEmpty ? (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-[var(--ag-c-FFFFFF)]">
                        <EmptyComponent
                            description={
                                <div className="flex flex-col gap-2">
                                    <span className="text-lg font-medium">{emptyTitle}</span>
                                    <span className="text-muted-foreground">
                                        Archived items will appear here and can be restored later.
                                    </span>
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
