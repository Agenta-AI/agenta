import {JSSTheme} from "@/lib/Types"
import {PlusOutlined} from "@ant-design/icons"
import {GearSix} from "@phosphor-icons/react"
import {Button, Space, Table, Typography} from "antd"
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

const AbTestingEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const columns: ColumnsType<any> = [
        {
            title: "Test set",
        },
        {
            title: "Variant 1",
        },
        {
            title: "Variant 2",
        },
        {
            title: "Both are good",
        },
        {
            title: "flag",
        },
        {
            title: "Created At",
        },
        {
            title: <GearSix size={16} />,
        },
    ]

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Title>A/B Testing Evaluations</Title>

                <Space>
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/annotations/human_a_b_testing?openHumanEvalModal=open`,
                            )
                        }
                    >
                        Start New
                    </Button>
                    <Button
                        type="text"
                        size="small"
                        href={`/apps/${appId}/annotations/human_a_b_testing`}
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

export default AbTestingEvalOverview
