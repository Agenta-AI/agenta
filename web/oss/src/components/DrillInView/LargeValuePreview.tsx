import {useMemo, useState} from "react"

import {CopyIcon} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import {
    formatRenderSize,
    getRenderStats,
    previewValueString,
    stringifyFullValue,
    type RenderBudgetMode,
    type RenderStats,
} from "./renderBudget"

interface LargeValuePreviewProps {
    value: unknown
    mode: RenderBudgetMode
    stats?: RenderStats
    title?: string
    onRenderFull?: () => void
    compact?: boolean
}

export default function LargeValuePreview({
    value,
    mode,
    stats: statsProp,
    title = "Large value preview",
    onRenderFull,
    compact = false,
}: LargeValuePreviewProps) {
    const [isCopying, setIsCopying] = useState(false)
    const stats = statsProp ?? getRenderStats(value)
    const preview = useMemo(() => previewValueString(value), [value])

    const handleCopyFull = async () => {
        setIsCopying(true)
        try {
            await copyToClipboard(stringifyFullValue(value))
        } finally {
            setIsCopying(false)
        }
    }

    const detailParts = [
        stats.type,
        formatRenderSize(stats.estimatedChars),
        stats.arrayLength !== undefined ? `${stats.arrayLength} items` : null,
        stats.objectKeyCount !== undefined ? `${stats.objectKeyCount} keys` : null,
        `mode: ${mode}`,
    ].filter(Boolean)

    return (
        <div
            className={`${compact ? "my-1" : "m-4"} flex flex-col gap-3 rounded-md border border-solid border-[rgba(5,23,41,0.08)] bg-white p-3`}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text strong>{title}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs">
                        {detailParts.join(" · ")}
                    </Typography.Text>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="small"
                        icon={<CopyIcon size={13} />}
                        loading={isCopying}
                        onClick={handleCopyFull}
                    >
                        Copy full
                    </Button>
                    {onRenderFull ? (
                        <Button size="small" onClick={onRenderFull}>
                            Render full
                        </Button>
                    ) : null}
                </div>
            </div>
            <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded bg-[#F6F8FB] p-2 font-mono text-xs text-[var(--ant-color-text)]">
                {preview}
            </pre>
        </div>
    )
}
