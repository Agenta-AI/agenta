import {type FC, ReactNode, useMemo, useState} from "react"

import {CheckOutlined, CopyOutlined} from "@ant-design/icons"
import {Button, Form, FormInstance, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {AutomationFormValues} from "@/oss/services/automations/types"
import {editingAutomationAtom} from "@/oss/state/automations/state"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectIdAtom} from "@/oss/state/project"

import {buildPreviewRequest} from "./utils/buildPreviewRequest"

interface Props {
    form: FormInstance
}

const HighlightedJson: FC<{data: Record<string, unknown>}> = ({data}) => {
    const jsonStr = JSON.stringify(data, null, 2)

    const lines = jsonStr.split("\n").map((line, i) => {
        const parts: ReactNode[] = []
        let keyIdx = 0

        const tokenRegex =
            /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g
        let lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = tokenRegex.exec(line)) !== null) {
            if (match.index > lastIndex) {
                parts.push(line.slice(lastIndex, match.index))
            }

            const token = match[0]
            let className = "text-[#d19a66]" // number - orange

            if (/^"/.test(token)) {
                if (/:$/.test(token)) {
                    className = "text-[#d19a66]" // key - orange
                } else {
                    className = "text-[#98c379]" // string value - green
                }
            } else if (/true|false|null/.test(token)) {
                className = "text-[#c678dd]" // boolean/null - purple
            }

            parts.push(
                <span key={`${i}-${keyIdx++}`} className={className}>
                    {token}
                </span>,
            )
            lastIndex = match.index + token.length
        }

        if (lastIndex < line.length) {
            parts.push(line.slice(lastIndex))
        }

        return (
            <div key={i} className="whitespace-pre-wrap">
                {parts}
            </div>
        )
    })

    return <>{lines}</>
}

export const RequestPreview: FC<Props> = ({form}) => {
    const [copied, setCopied] = useState(false)
    const projectId = useAtomValue(projectIdAtom)
    const user = useAtomValue(userAtom)
    const editingAutomation = useAtomValue(editingAutomationAtom)

    const formValues: AutomationFormValues = Form.useWatch((values) => values, form) || {
        provider: "webhook",
    }

    const preview = useMemo(() => {
        try {
            return buildPreviewRequest(formValues, {
                projectId: projectId || undefined,
                subscriptionId: editingAutomation?.id,
                userId: user?.id,
            })
        } catch {
            return null
        }
    }, [formValues, projectId, user?.id, editingAutomation?.id])

    if (!preview || !preview.url) {
        return null
    }

    const handleCopy = async () => {
        const textToCopy = `POST ${preview.url}\n\nHeaders:\n${JSON.stringify(preview.headers, null, 2)}\n\nBody:\n${JSON.stringify(preview.body, null, 2)}`
        try {
            await navigator.clipboard.writeText(textToCopy)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard write failed silently
        }
    }

    return (
        <div className="relative overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-code)] font-mono">
            <div className="mb-3 flex items-center justify-between border-b border-[var(--color-border)] pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Example HTTP Request
                </span>
            </div>

            <Tooltip title={copied ? "Copied!" : "Copy request"}>
                <Button
                    type="text"
                    icon={copied ? <CheckOutlined style={{color: "#98c379"}} /> : <CopyOutlined />}
                    className="absolute right-2 top-2 text-[var(--color-text-tertiary)] hover:bg-transparent hover:text-[var(--color-text-primary)]"
                    onClick={handleCopy}
                />
            </Tooltip>

            <div className="mb-3">
                <span className="mr-2 font-bold text-[#c678dd]">{preview.method}</span>
                <span className="break-all text-[#98c379]">{preview.url}</span>
            </div>

            {Object.keys(preview.headers).length > 0 && (
                <div>
                    <span className="mt-3 mb-1 block text-[var(--color-text-secondary)]">
                        Headers
                    </span>
                    <HighlightedJson data={preview.headers} />
                </div>
            )}

            <div>
                <span className="mt-3 mb-1 block text-[var(--color-text-secondary)]">
                    JSON Body
                </span>
                <HighlightedJson data={preview.body as Record<string, unknown>} />
            </div>
        </div>
    )
}
