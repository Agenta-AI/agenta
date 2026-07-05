/**
 * McpServerItemControl
 *
 * Schema-driven control for one declared MCP server on the agent config. MCP servers are a
 * sibling of `tools` (not a tool variant): a server names a transport (stdio command/args/env
 * or a remote url), an optional tool allowlist, and the vault secret names the backend resolves
 * into its env at run time. The shape is open enough that a JSON editor is the pragmatic v1 —
 * the same approach ToolItemControl takes for tool definitions — with a name header and a delete
 * control. The typed shape lives in the `agent-template` catalog type (AgentTemplateSchema /
 * McpServer in the SDK); this control just edits one entry of the `agent.mcps` array.
 */
import {memo, useCallback, useEffect, useRef, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {safeStringify} from "@agenta/shared/utils"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {MinusCircle} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import clsx from "clsx"

export interface McpServerItemControlProps {
    /** MCP server value (object or JSON string) */
    value: unknown
    /** Called when the server value changes (only on valid JSON) */
    onChange?: (value: Record<string, unknown>) => void
    /** Called when the server should be removed */
    onDelete?: () => void
    /** Whether the control is read-only */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

function toServerObj(value: unknown): Record<string, unknown> {
    try {
        if (typeof value === "string") {
            if (!value) return {}
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
            return {}
        }
        if (value && typeof value === "object" && !Array.isArray(value))
            return value as Record<string, unknown>
    } catch {
        // fall through to empty object
    }
    return {}
}

export const McpServerItemControl = memo(function McpServerItemControl({
    value,
    onChange,
    onDelete,
    disabled = false,
    className,
}: McpServerItemControlProps) {
    const {SharedEditor} = useDrillInUI()
    const serverObj = toServerObj(value)
    const name =
        typeof serverObj.name === "string" && serverObj.name ? serverObj.name : "MCP server"

    const [editorText, setEditorText] = useState<string>(() => safeStringify(serverObj ?? {}))

    // Reset the editor text when the value changes from outside (add/remove/reorder).
    const lastExternalRef = useRef<string>(safeStringify(serverObj ?? {}))
    useEffect(() => {
        const next = safeStringify(toServerObj(value) ?? {})
        if (next !== lastExternalRef.current) {
            lastExternalRef.current = next
            setEditorText(next)
        }
    }, [value])

    const handleEditorChange = useCallback(
        (text: string) => {
            if (disabled) return
            setEditorText(text)
            try {
                const parsed = text ? JSON.parse(text) : {}
                // Only a JSON object is a valid server config; ignore arrays/scalars so we
                // don't propagate a value toServerObj() would silently collapse back to {}.
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
                lastExternalRef.current = safeStringify(parsed)
                onChange?.(parsed as Record<string, unknown>)
            } catch {
                // Keep the invalid text in the editor; don't propagate until it parses.
            }
        },
        [disabled, onChange],
    )

    const header = (
        <div className="w-full flex items-center justify-between py-1">
            <span className="text-sm truncate font-semibold">{name}</span>
            {!disabled && onDelete && (
                <Tooltip title="Remove">
                    <Button
                        onClick={onDelete}
                        className="invisible group-hover/mcp:visible shrink-0"
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<MinusCircle size={14} />}
                    </Button>
                </Tooltip>
            )}
        </div>
    )

    if (!SharedEditor) {
        return (
            <div className={clsx("group/mcp flex flex-col gap-2 border rounded-lg p-3", className)}>
                {header}
                <textarea
                    className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
                    value={editorText}
                    onChange={(e) => handleEditorChange(e.target.value)}
                    readOnly={disabled}
                />
            </div>
        )
    }

    return (
        <div className={clsx("group/mcp flex flex-col w-full max-w-full", className)}>
            <SharedEditor
                initialValue={editorText}
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                    noProvider: true,
                }}
                handleChange={handleEditorChange}
                noProvider
                disableDebounce
                syncWithInitialValueChanges
                editorType="border"
                state={disabled ? "readOnly" : "filled"}
                header={header}
            />
        </div>
    )
})
