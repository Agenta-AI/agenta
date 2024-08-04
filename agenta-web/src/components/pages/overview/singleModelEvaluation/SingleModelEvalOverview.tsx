import {JSSTheme} from "@/lib/Types"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {GearSix} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React from "react"
import {createUseStyles} from "react-jss"

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > div h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
}))

const SingleModelEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const columns: ColumnsType<any> = [
        {
            title: "Test set",
        },
        {
            title: "Variant",
        },
        {
            title: "Average Score",
        },
        {
            title: "Created At",
        },
        {
            title: <GearSix size={16} />,
            key: "settings",
            width: 50,
            render: () => {
                return (
                    <Dropdown
                        trigger={["hover"]}
                        menu={{
                            items: [
                                {
                                    key: "change_variant",
                                    label: "Change Variant",
                                },

                                {
                                    key: "open_playground",
                                    label: "Open in playground",
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<MoreOutlined />} size="small" />
                    </Dropdown>
                )
            },
        },
    ]

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Title>Single Model Evaluations</Title>

                <Space>
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/annotations/single_model_test?openHumanEvalModal=open`,
                            )
                        }
                    >
                        Start New
                    </Button>
                    <Button
                        type="text"
                        size="small"
                        href={`/apps/${appId}/annotations/single_model_test`}
                    >
                        View All
                    </Button>
                </Space>
            </div>

            <div>
                <Table className="ph-no-capture" columns={columns} dataSource={[]} />
            </div>
        </div>
    )
}

export default SingleModelEvalOverview
