import React, {useMemo} from "react"

import {Card, Divider, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {
    revisionsByVariantIdAtomFamily,
    enhancedRevisionByIdAtomFamily,
    revisionIdToVariantIdAtom,
} from "@/oss/state/variant/atoms/fetcher"

interface ReadOnlyPromptConfigProps {
    variantId: string
    revision?: number | string | null
    className?: string
    parameters?: any | null
    agConfig?: Record<string, any> | null
}

function isObject(v: any): v is Record<string, any> {
    return v != null && typeof v === "object" && !Array.isArray(v)
}

function stringifyJson(value: any): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        try {
            return String(value)
        } catch {
            return ""
        }
    }
}

const ReadOnlyPromptConfig: React.FC<ReadOnlyPromptConfigProps> = ({
    variantId,
    revision,
    className,
    parameters,
    agConfig: agConfigOverride,
}) => {
    // Determine if the provided variantId is actually a revisionId
    const revisionIndexSelector = useMemo(
        () => selectAtom(revisionIdToVariantIdAtom, (m) => m as Record<string, string>),
        [],
    )
    const revisionIndex = useAtomValue(revisionIndexSelector)
    const isRevisionId = Boolean((revisionIndex || {})[variantId])

    const rev = useAtomValue(
        useMemo(() => {
            if (isRevisionId) return enhancedRevisionByIdAtomFamily(variantId)
            // Select the target revision by numeric/string "revision" field when provided
            const revisionsAtom = revisionsByVariantIdAtomFamily(variantId)
            return selectAtom(
                revisionsAtom,
                (revs: any[]) => {
                    if (!Array.isArray(revs) || revs.length === 0) return null
                    if (revision != null) {
                        const match = revs.find((r: any) => String(r.revision) === String(revision))
                        if (match) return match
                    }
                    // Fallback: most recent by timestamp or revision number
                    return revs.reduce((acc: any, r: any) => {
                        if (!acc) return r
                        const aTs = acc.createdAtTimestamp ?? acc.revision ?? 0
                        const rTs = r.createdAtTimestamp ?? r.revision ?? 0
                        return aTs >= rTs ? acc : r
                    }, null as any)
                },
                (a, b) => a?.id === b?.id,
            )
        }, [variantId, revision, isRevisionId]),
    ) as any

    const agConfig = (agConfigOverride ??
        parameters?.ag_config ??
        parameters ??
        rev?.parameters?.ag_config ??
        rev?.parameters ??
        {}) as Record<string, any>

    // Normalize to entries: either a map of promptName -> config, or a single prompt under "prompt"
    const promptEntries = useMemo(() => {
        if (!isObject(agConfig)) return [] as [string, any][]
        // If it looks like the transformer shape (keys are prompt names)
        const entries = Object.entries(agConfig)
        const looksNamed = entries.every(([k, v]) => isObject(v) && (v as any)?.messages)
        if (looksNamed) return entries
        // Otherwise check conventional ag_config.prompt or ag_config.prompts
        if (Array.isArray((agConfig as any).prompts)) {
            return (agConfig as any).prompts.map((cfg: any, idx: number) => [
                cfg?.name || `Prompt ${idx + 1}`,
                cfg,
            ])
        }
        if ((agConfig as any).prompt) {
            return [[(agConfig as any).prompt?.name || "Prompt", (agConfig as any).prompt]]
        }
        return [] as [string, any][]
    }, [agConfig])

    if (!rev && !isObject(agConfig)) {
        return (
            <Card className={className} size="small">
                <Typography.Text type="secondary">No revision found</Typography.Text>
            </Card>
        )
    }

    return (
        <div className={clsx("flex flex-col gap-3", className)}>
            {promptEntries.map(([name, cfg]) => {
                const messages = Array.isArray(cfg?.messages) ? cfg.messages : []
                const llm = isObject(cfg?.llm_config) ? cfg.llm_config : {}
                const tools = Array.isArray(llm?.tools) ? llm.tools : []
                const responseFormat = llm?.response_format

                return (
                    <Card key={name} size="small">
                        <div className="flex items-center justify-between">
                            <Typography.Title level={5} className="!mb-0">
                                {name}
                            </Typography.Title>
                            {llm?.model ? <Tag>{llm.model}</Tag> : null}
                        </div>

                        {/* Messages */}
                        <Divider orientation="left" className="!my-3">
                            Messages
                        </Divider>
                        <div className="flex flex-col gap-8">
                            {messages.length === 0 ? (
                                <Typography.Text type="secondary">No messages</Typography.Text>
                            ) : (
                                messages.map((m: any, idx: number) => {
                                    const role = m?.role || m?.role?.value || "user"
                                    const content = m?.content?.value ?? m?.content
                                    const text = Array.isArray(content)
                                        ? content
                                              .map(
                                                  (p: any) =>
                                                      p?.text?.value ||
                                                      p?.text ||
                                                      p?.image_url?.url ||
                                                      "",
                                              )
                                              .filter(Boolean)
                                              .join("\n\n")
                                        : typeof content === "string"
                                          ? content
                                          : stringifyJson(content)
                                    return (
                                        <div
                                            key={m?.id || m?.__id || idx}
                                            className="flex flex-col gap-1"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Tag>{role}</Tag>
                                            </div>
                                            <SharedEditor
                                                initialValue={text}
                                                editorProps={{
                                                    codeOnly: false,
                                                    enableTokens: false,
                                                    showToolbar: false,
                                                }}
                                                editorType="border"
                                                className="w-full"
                                                state="readOnly"
                                            />
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        {/* Tools */}
                        <Divider orientation="left" className="!my-3">
                            Tools
                        </Divider>
                        {tools.length === 0 ? (
                            <Typography.Text type="secondary">No tools</Typography.Text>
                        ) : (
                            <div className="flex flex-col gap-2 text-[13px]">
                                {tools.map((t: any, i: number) => (
                                    <pre key={t?.name || i} className="m-0">
                                        {stringifyJson(t)}
                                    </pre>
                                ))}
                            </div>
                        )}

                        {/* Response format */}
                        <Divider orientation="left" className="!my-3">
                            Response Format
                        </Divider>
                        {responseFormat ? (
                            <div className="text-[13px]">
                                {typeof responseFormat === "string" ? (
                                    <Tag>{responseFormat}</Tag>
                                ) : responseFormat?.type === "json_schema" ? (
                                    <>
                                        <Tag>json_schema</Tag>
                                        <pre className="m-0 mt-2">
                                            {stringifyJson(responseFormat.json_schema)}
                                        </pre>
                                    </>
                                ) : responseFormat?.type ? (
                                    <Tag>{responseFormat.type}</Tag>
                                ) : (
                                    <pre className="m-0">{stringifyJson(responseFormat)}</pre>
                                )}
                            </div>
                        ) : (
                            <Typography.Text type="secondary">Default (text)</Typography.Text>
                        )}
                    </Card>
                )
            })}
        </div>
    )
}

export default ReadOnlyPromptConfig
