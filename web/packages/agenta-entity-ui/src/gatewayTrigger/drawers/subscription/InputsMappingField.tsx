/** The non-agent mapping editor: raw `inputs_fields` JSON with per-leaf selector previews. */
import {useEffect, useMemo} from "react"

import {previewValue, resolveSelectorPreview} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Collapse, Form, Typography} from "antd"

import {buildPreviewContext} from "./helpers"

// ---------------------------------------------------------------------------
// Non-agent mapping: raw-JSON editor with live selector validation + path hints
// (restored committed behavior). Each leaf string is a selector resolved at delivery
// (`$...` JSONPath, `/...` JSON Pointer, else literal); we preview each against the sample.
// ---------------------------------------------------------------------------

interface MappingLeaf {
    key: string
    isSelector: boolean
    resolved?: string
}

function analyzeMapping(
    text: string,
    context: Record<string, unknown> | null,
): {leaves: MappingLeaf[]; parseError: string | null} {
    const trimmed = text.trim()
    if (!trimmed) return {leaves: [], parseError: null}
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch (e) {
        return {leaves: [], parseError: e instanceof Error ? e.message : "Invalid JSON"}
    }
    if (typeof parsed === "string") {
        const isSelector = parsed.startsWith("$") || parsed.startsWith("/")
        const resolved = isSelector && context ? resolveSelectorPreview(parsed, context) : undefined
        return {
            leaves: [
                {
                    key: "(whole context)",
                    isSelector,
                    resolved: resolved === undefined ? undefined : previewValue(resolved),
                },
            ],
            parseError: null,
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {leaves: [], parseError: "Mapping must be a JSON object or a selector string"}
    }
    const leaves: MappingLeaf[] = []
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof rawValue !== "string") {
            leaves.push({key, isSelector: false})
            continue
        }
        const isSelector = rawValue.startsWith("$") || rawValue.startsWith("/")
        if (!isSelector) {
            leaves.push({key, isSelector: false})
            continue
        }
        const resolved = context ? resolveSelectorPreview(rawValue, context) : undefined
        leaves.push({
            key,
            isSelector: true,
            resolved: resolved === undefined ? undefined : previewValue(resolved),
        })
    }
    return {leaves, parseError: null}
}

export function InputsMappingField({
    value,
    onChange,
    error,
    onErrorChange,
    eventPayload,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    onErrorChange: (next: string | null) => void
    eventPayload: Record<string, unknown> | null
}) {
    const context = useMemo(() => buildPreviewContext(eventPayload), [eventPayload])
    const {leaves, parseError} = useMemo(() => analyzeMapping(value, context), [value, context])
    useEffect(() => {
        onErrorChange(parseError)
    }, [parseError, onErrorChange])
    const payloadKeys = useMemo(
        () =>
            Object.keys(
                (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {},
            ).map((k) => `event.attributes.${k}`),
        [context],
    )
    return (
        <Form.Item
            label="Inputs mapping"
            validateStatus={error ? "error" : undefined}
            help={error ?? "Maps event context to the workflow inputs (JSON)"}
        >
            <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                <Editor
                    initialValue={value || "{}"}
                    onChange={({textContent}) => onChange(textContent)}
                    codeOnly
                    showToolbar={false}
                    language="json"
                    dimensions={{width: "100%", height: 120}}
                />
            </div>
            <Typography.Text type="secondary" className="mt-1 block !text-[11px] leading-snug">
                String values are selectors against the event payload: <code>$.path</code>{" "}
                (JSONPath), <code>/path</code> (JSON Pointer), or a literal.
            </Typography.Text>
            {payloadKeys.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Typography.Text type="secondary" className="!text-[11px]">
                        Available:
                    </Typography.Text>
                    {payloadKeys.slice(0, 12).map((k) => (
                        <code
                            key={k}
                            className="rounded bg-[var(--ag-colorFillSecondary)] px-1 text-[11px] text-[var(--ag-colorText)]"
                        >
                            $.{k}
                        </code>
                    ))}
                    {payloadKeys.length > 12 && (
                        <Typography.Text type="secondary" className="!text-[11px]">
                            +{payloadKeys.length - 12} more
                        </Typography.Text>
                    )}
                </div>
            )}
            {eventPayload && (
                <Collapse
                    ghost
                    size="small"
                    defaultActiveKey={["sample"]}
                    className="mt-1 [&_.ant-collapse-content-box]:!p-0 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-header]:!py-1"
                    items={[
                        {
                            key: "sample",
                            label: (
                                <Typography.Text type="secondary" className="!text-[11px]">
                                    test event attributes
                                </Typography.Text>
                            ),
                            children: (
                                <pre className="m-0 max-h-[240px] overflow-auto rounded bg-[var(--ag-colorFillTertiary)] p-2 text-[11px] leading-snug text-[var(--ag-colorText)]">
                                    {JSON.stringify(eventPayload, null, 2)}
                                </pre>
                            ),
                        },
                    ]}
                />
            )}
            {!parseError && leaves.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                    {leaves.map((leaf, i) => (
                        <div
                            key={`${leaf.key}-${i}`}
                            className="flex items-center gap-1.5 text-[11px] leading-snug"
                        >
                            <code className="text-[var(--ag-colorTextSecondary)]">{leaf.key}</code>
                            <span className="text-[var(--ag-colorTextTertiary)]">→</span>
                            {leaf.isSelector ? (
                                leaf.resolved === undefined ? (
                                    <Typography.Text type="warning" className="!text-[11px]">
                                        no sample value
                                    </Typography.Text>
                                ) : (
                                    <code className="max-w-[280px] truncate text-[var(--ag-colorSuccess)]">
                                        {leaf.resolved}
                                    </code>
                                )
                            ) : (
                                <Typography.Text type="secondary" className="!text-[11px]">
                                    literal
                                </Typography.Text>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Form.Item>
    )
}
