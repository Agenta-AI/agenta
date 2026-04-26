import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useRouter} from "next/router"

import type {ArchivedEntityLayoutProps} from "./types"

export default function ArchivedEntityLayout({
    title,
    subtitle,
    onBack,
    children,
}: ArchivedEntityLayoutProps) {
    const router = useRouter()
    const handleBack = onBack ?? (() => router.back())

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

            <div className="min-h-0 flex-1">{children}</div>
        </div>
    )
}
