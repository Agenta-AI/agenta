import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import {getColorFromStr} from "@/lib/helpers/colors"
import {getVotesPercentage} from "@/lib/helpers/evaluate"
import {getInitials, isDemo} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {JSSTheme} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowsLeftRight,
    Columns,
    Database,
    GearSix,
    Note,
    Plus,
    Rocket,
    Trash,
} from "@phosphor-icons/react"
import {Avatar, Button, Dropdown, Space, Statistic, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

interface AbTestingEvaluationProps {
    evaluationList: HumanEvaluationListTableDataType[]
    fetchingEvaluations: boolean
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    button: {
        display: "flex",
        alignItems: "center",
    },
    statFlag: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorError,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorError,
        },
    },
    stat: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
    },
    statGood: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorSuccess,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorSuccess,
        },
    },
}))

const AbTestingEvaluation = ({evaluationList, fetchingEvaluations}: AbTestingEvaluationProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const columns: ColumnsType<HumanEvaluationListTableDataType> = [
        {
            title: "Variant A",
            dataIndex: "variantNames",
            key: "variant1",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                return (
                    <div>
                        {variantNameWithRev({
                            variant_name: value[0],
                            revision: record.revisions[0],
                        })}
                    </div>
                )
            },
        },
        {
            title: "Variant B",
            dataIndex: "variantNames",
            key: "variant2",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                return (
                    <div>
                        {variantNameWithRev({
                            variant_name: value[1],
                            revision: record.revisions[1],
                        })}
                    </div>
                )
            },
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record: HumanEvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Results",
            key: "results",
            onHeaderCell: () => ({
                style: {minWidth: 240},
            }),
            render: (_, record: HumanEvaluationListTableDataType) => {
                const stat1 = getVotesPercentage(record, 0)
                const stat2 = getVotesPercentage(record, 1)

                return (
                    <div className="flex items-center gap-2">
                        <Statistic
                            className={classes.stat}
                            value={stat1}
                            precision={stat1 <= 99 ? 2 : 1}
                            suffix="%"
                        />
                        |
                        <Statistic
                            className={classes.stat}
                            value={stat2}
                            precision={stat2 <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </div>
                )
            },
        },
        {
            title: "Both are good",
            dataIndex: "positive",
            key: "positive",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record: HumanEvaluationListTableDataType) => {
                let percentage = record.votesData.positive_votes.percentage
                return (
                    <span>
                        <Statistic
                            className={classes.statGood}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
        {
            title: "Flag",
            dataIndex: "flag",
            key: "flag",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value: any, record: HumanEvaluationListTableDataType) => {
                let percentage = record.votesData.flag_votes.percentage
                return (
                    <span>
                        <Statistic
                            className={classes.statFlag}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "User",
            dataIndex: ["user", "username"],
            key: "username",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record: any) => {
                return (
                    <Space>
                        <Avatar
                            size={"small"}
                            style={{
                                backgroundColor: getColorFromStr(record.user.id),
                                color: "#fff",
                            }}
                        >
                            {getInitials(record.user.username)}
                        </Avatar>
                        <Typography.Text>{record.user.username}</Typography.Text>
                    </Space>
                )
            },
        })
    }

    columns.push(
        ...([
            {
                title: "Created on",
                dataIndex: "createdAt",
                key: "createdAt",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
            },
            {
                title: <GearSix size={16} />,
                key: "key",
                width: 56,
                fixed: "right",
                align: "center",
                render: (_: any, record: HumanEvaluationListTableDataType) => {
                    return (
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 180}}
                            menu={{
                                items: [
                                    {
                                        key: "details",
                                        label: "Open details",
                                        icon: <Note size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            router.push(
                                                `/apps/${appId}/annotations/human_a_b_testing/${record.key}`,
                                            )
                                        },
                                    },
                                    {
                                        key: "variant1",
                                        label: "View variant 1",
                                        icon: <Rocket size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleNavigation(
                                                record.variantNames[0],
                                                record.revisions[0],
                                            )
                                        },
                                    },
                                    {
                                        key: "variant2",
                                        label: "View variant 2",
                                        icon: <Rocket size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleNavigation(
                                                record.variantNames[1],
                                                record.revisions[1],
                                            )
                                        },
                                    },
                                    {
                                        key: "view_testset",
                                        label: "View test set",
                                        icon: <Database size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            router.push(
                                                `/apps/${appId}/testsets/${record.testset._id}`,
                                            )
                                        },
                                    },
                                    {type: "divider"},
                                    {
                                        key: "delete_eval",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        danger: true,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button
                                onClick={(e) => e.stopPropagation()}
                                type="text"
                                icon={<MoreOutlined />}
                                size="small"
                            />
                        </Dropdown>
                    )
                },
            },
        ] as any),
    )

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <Button type="primary" icon={<Plus size={14} />} className={classes.button}>
                    Start new evaluation
                </Button>

                <Space>
                    <Button
                        danger
                        type="text"
                        icon={<Trash size={14} />}
                        className={classes.button}
                    >
                        Delete
                    </Button>
                    <Button
                        type="text"
                        icon={<ArrowsLeftRight size={14} />}
                        className={classes.button}
                    >
                        Compare
                    </Button>
                </Space>
            </div>

            <Table
                loading={fetchingEvaluations}
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedRowKeys(selectedRowKeys)
                    },
                }}
                className="ph-no-capture"
                columns={columns}
                rowKey={"id"}
                dataSource={evaluationList}
                scroll={{x: true}}
                bordered
                pagination={false}
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {},
                })}
            />
        </div>
    )
}

export default AbTestingEvaluation
