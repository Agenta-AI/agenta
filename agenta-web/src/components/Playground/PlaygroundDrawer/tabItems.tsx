import {useAppId} from "@/hooks/useAppId"
import {TraceSpan, TraceSpanDetails} from "@/lib/Types"
import {Card, Divider, Space, Tag, Typography} from "antd"
import React, {ReactNode, isValidElement} from "react"
import {StatusRenderer} from "./cellRenderers"
import Link from "next/link"
import _ from "lodash"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {formatDate24} from "@/lib/helpers/dateTimeHelper"
import {formatCurrency, formatLatency, formatNumber} from "@/lib/helpers/formatters"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {snakeToTitle} from "@/lib/helpers/utils"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    detailItem: {
        display: "flex",
        width: "100%",
        gap: "1rem",
        "& > *:first-child": {
            width: 140,
            fontWeight: 500,
        },
        "& > *:last-child": {
            flex: 1,
        },
    },
    detailItemDivider: {
        margin: "0.5rem 0",
    },
    fullWidth: {
        width: "100%",
    },
    contentCard: {
        "& > div.ant-card-head": {
            padding: "8px 12px",
            minHeight: 42,
            "& .ant-card-head-title": {
                fontSize: 12,
                fontWeight: "bold",
                textTransform: "uppercase",
            },
        },
        "& > div.ant-card-body": {
            padding: 12,
        },
    },
}))

const DetailItem: React.FC<{name: ReactNode; value: ReactNode}> = ({name, value}) => {
    const classes = useStyles()
    return (
        <>
            <div className={classes.detailItem}>
                {!isValidElement(name) ? <Typography.Text>{name}</Typography.Text> : name}
                {!isValidElement(value) ? <Typography.Text>{value}</Typography.Text> : value}
            </div>
            <Divider className={classes.detailItemDivider} />
        </>
    )
}

export const GenerationDetailsTab: React.FC<{generation: TraceSpan}> = ({generation}) => {
    const appId = useAppId()
    return (
        <>
            <DetailItem name="Id" value={generation.id} />
            <DetailItem name="Created At" value={formatDate24(generation.created_at, true)} />
            <DetailItem name="Status" value={<StatusRenderer data={generation} />} />
            <DetailItem
                name="Variant"
                value={
                    <Link
                        href={`/apps/${appId}/playground?variant=${generation.variant?.variant_name}&revision=${generation.variant?.revision}`}
                    >
                        {variantNameWithRev({
                            ...generation.variant,
                            variant_name: generation.variant.variant_name || "",
                        })}
                    </Link>
                }
            />
            <DetailItem name="Environment" value={generation.environment} />
            <DetailItem name="Latency" value={formatLatency(generation.metadata?.latency)} />
            <DetailItem name="Cost" value={formatCurrency(Number(generation.metadata?.cost))} />
            <DetailItem
                name="Total Tokens"
                value={formatNumber(generation.metadata?.usage?.total_tokens)}
            />
            <DetailItem
                name="Completion Tokens"
                value={formatNumber(generation.metadata?.usage?.completion_tokens)}
            />
            <DetailItem
                name="Prompt Tokens"
                value={formatNumber(generation.metadata?.usage?.prompt_tokens)}
            />
            <DetailItem name="User Id" value={generation.user_id} />
        </>
    )
}

export const GenerationContentTab: React.FC<{data: TraceSpanDetails}> = ({data}) => {
    const classes = useStyles()
    const output = (data.content.outputs?.[0] ?? "").toString()

    return (
        <Space direction="vertical" size="large" className={classes.fullWidth}>
            {data.content.inputs.map((input, ix) => (
                <Card
                    key={input.input_name + ix}
                    title="Input"
                    extra={<Tag>{input.input_name}</Tag>}
                    className={classes.contentCard}
                >
                    <Typography className="whitespace-pre-line">
                        {typeof input.input_value === "string"
                            ? input.input_value
                            : JSON.stringify(input.input_value)}
                    </Typography>
                </Card>
            ))}
            {output && (
                <Card
                    title={"Output"}
                    extra={data.content?.role ? <Tag>{data.content.role}</Tag> : null}
                    className={classes.contentCard}
                >
                    <Typography className="whitespace-pre-line">{output}</Typography>
                </Card>
            )}
        </Space>
    )
}

export const GenerationModelConfigTab: React.FC<{data: TraceSpanDetails}> = ({data}) => {
    return (
        <>
            {data.config &&
                Object.entries(data.config).map(([key, value]) => (
                    <DetailItem
                        key={key}
                        name={snakeToTitle(key)}
                        value={typeof value === "string" ? value : JSON.stringify(value)}
                    />
                ))}
        </>
    )
}
