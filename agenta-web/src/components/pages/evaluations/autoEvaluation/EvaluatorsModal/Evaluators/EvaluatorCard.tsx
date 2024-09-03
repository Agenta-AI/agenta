import {EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, Note, Trash} from "@phosphor-icons/react"
import {Button, Card, Dropdown, Tag, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface EvaluatorCardProps {
    evaluatorConfigs: EvaluatorConfig[]
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingLG,
        height: 600,
        overflowY: "auto",
    },
    cardTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    evaluatorCard: {
        width: 276,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.025s ease-in",
        cursor: "pointer",
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
            display: "flex",
            flexDirection: "column",
            gap: theme.marginXS,
            "& div": {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
            },
        },
        "&:hover": {},
    },
}))

const EvaluatorCard = ({evaluatorConfigs}: EvaluatorCardProps) => {
    const classes = useStyles()

    const formatEvluatorConfigs = Object.entries(
        evaluatorConfigs.reduce(
            (acc, curr) => {
                if (!acc[curr.evaluator_key]) {
                    acc[curr.evaluator_key] = []
                }
                acc[curr.evaluator_key].push(curr)
                return acc
            },
            {} as Record<string, EvaluatorConfig[]>,
        ),
    ).map(([title, items]) => ({
        title,
        items,
    }))

    return (
        <div className={classes.container}>
            {formatEvluatorConfigs.map(({title, items}) => (
                <div className="flex flex-col gap-2" key={title}>
                    <Typography.Text className={classes.cardTitle}>{title}</Typography.Text>
                    <div className="flex gap-4">
                        {items.map((item) => (
                            <Card
                                key={item.id}
                                className={classes.evaluatorCard}
                                title={item.name}
                                extra={
                                    <Dropdown
                                        trigger={["hover"]}
                                        placement="bottomRight"
                                        overlayStyle={{width: 180}}
                                        menu={{
                                            items: [
                                                {
                                                    key: "view_config",
                                                    label: "View configuration",
                                                    icon: <Note size={16} />,
                                                    onClick: (e: any) => {
                                                        e.domEvent.stopPropagation()
                                                    },
                                                },
                                                {
                                                    key: "clone",
                                                    label: "Clone",
                                                    icon: <Copy size={16} />,
                                                    onClick: (e: any) => {
                                                        e.domEvent.stopPropagation()
                                                    },
                                                },
                                                {type: "divider"},
                                                {
                                                    key: "delete_app",
                                                    label: "Delete",
                                                    icon: <Trash size={16} />,
                                                    danger: true,
                                                    onClick: (e: any) => {
                                                        e.domEvent.stopPropagation()
                                                    },
                                                },
                                            ],
                                        }}
                                    >
                                        <Button
                                            type="text"
                                            onClick={(e) => e.stopPropagation()}
                                            icon={<MoreOutlined />}
                                            size="small"
                                        />
                                    </Dropdown>
                                }
                            >
                                <div>
                                    <Typography.Text>Type</Typography.Text>
                                    <Tag color="cyan" className="mr-0">
                                        cyan
                                    </Tag>
                                </div>
                                <div>
                                    <Typography.Text>Version</Typography.Text>
                                    <Typography.Text type="secondary">v1.1</Typography.Text>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

export default EvaluatorCard
