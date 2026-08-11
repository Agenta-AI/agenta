import {Button, Select, Table} from "antd"

import type {AgentaNode} from "./types"

export interface NodeRendererProps {
    node: AgentaNode
    /** The "degrade to text, never to nothing" path, exercised without a text-only platform to hand. */
    degraded?: boolean
    /** Fires with the choice token a real send would post as an ordinary message. */
    onChoice?: (token: string) => void
}

const TABLE_DEGRADED_ROW_LIMIT = 5

function ChoiceOptions({
    options,
    degraded,
    asSelect,
    onChoice,
}: {
    options: {id: string; label: string}[]
    degraded: boolean
    asSelect: boolean
    onChoice?: (token: string) => void
}) {
    if (degraded) {
        return (
            <ol className="m-0 flex flex-col gap-1 pl-5">
                {options.map((option, index) => (
                    <li key={option.id}>
                        <button
                            type="button"
                            className="cursor-pointer bg-transparent p-0 text-left underline"
                            onClick={() => onChoice?.(String(index + 1))}
                        >
                            {index + 1}. {option.label}
                        </button>
                    </li>
                ))}
            </ol>
        )
    }

    if (asSelect) {
        return (
            <Select
                className="min-w-[200px]"
                placeholder="Choose..."
                options={options.map((option) => ({label: option.label, value: option.id}))}
                onChange={(value) => onChoice?.(String(value))}
            />
        )
    }

    return (
        <div className="flex flex-wrap gap-2">
            {options.map((option) => (
                <Button key={option.id} size="small" onClick={() => onChoice?.(option.id)}>
                    {option.label}
                </Button>
            ))}
        </div>
    )
}

export default function NodeRenderer({node, degraded = false, onChoice}: NodeRendererProps) {
    switch (node.type) {
        case "text":
            return <p className="m-0 whitespace-pre-wrap">{node.text}</p>

        case "buttons":
            return (
                <ChoiceOptions
                    options={node.options}
                    degraded={degraded}
                    asSelect={false}
                    onChoice={onChoice}
                />
            )

        case "select":
            return (
                <ChoiceOptions
                    options={node.options}
                    degraded={degraded}
                    asSelect={true}
                    onChoice={onChoice}
                />
            )

        case "fields":
            if (degraded) {
                return (
                    <pre className="m-0 whitespace-pre-wrap">
                        {node.fields.map((field) => `${field.label}: ${field.value}`).join("\n")}
                    </pre>
                )
            }
            return (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {node.fields.map((field, index) => (
                        <div
                            className="col-span-2 grid grid-cols-[auto_1fr]"
                            key={`${field.label}-${index}`}
                        >
                            <dt className="font-medium">{field.label}</dt>
                            <dd className="m-0">{field.value}</dd>
                        </div>
                    ))}
                </dl>
            )

        case "table":
            if (degraded) {
                const shown = node.rows.slice(0, TABLE_DEGRADED_ROW_LIMIT)
                const truncated = node.rows.length > TABLE_DEGRADED_ROW_LIMIT
                return (
                    <ul className="m-0 flex flex-col gap-0.5 pl-5">
                        {shown.map((row, index) => (
                            <li key={index}>{row[0] ?? ""}</li>
                        ))}
                        {truncated && <li>…</li>}
                    </ul>
                )
            }
            return (
                <Table
                    size="small"
                    pagination={false}
                    dataSource={node.rows.map((row, index) => ({key: index, row}))}
                    columns={node.columns.map((column, colIndex) => ({
                        title: column,
                        key: column,
                        render: (_: unknown, record: {row: string[]}) => record.row[colIndex] ?? "",
                    }))}
                />
            )

        case "image":
            if (degraded) {
                return <p className="m-0 break-all">{node.url}</p>
            }
            return (
                <figure className="m-0 flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension image */}
                    <img src={node.url} alt={node.caption ?? ""} className="max-w-full" />
                    {node.caption && (
                        <figcaption className="text-xs text-colorTextSecondary">
                            {node.caption}
                        </figcaption>
                    )}
                </figure>
            )

        default:
            return null
    }
}
