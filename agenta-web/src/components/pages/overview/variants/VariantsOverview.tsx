import {JSSTheme} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {GearSix, Rocket} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import Link from "next/link"
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
    titleLink: {
        display: "flex",
        alignItems: "center",
        gap: theme.paddingXS,
        border: `1px solid ${theme.colorBorder}`,
        padding: "1px 7px",
        height: 24,
        borderRadius: theme.borderRadius,
        color: theme.colorText,
        "&:hover": {
            borderColor: theme.colorInfoBorderHover,
            transition: "all 0.2s cubic-bezier(0.645, 0.045, 0.355, 1)",
        },
    },
}))
const VariantsOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const columns: ColumnsType<any> = [
        {
            title: "Name",
        },
        {
            title: "Tokens",
        },
        {
            title: "Cost",
        },
        {
            title: "Latency",
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
                <Title>Variants</Title>

                <Link href={`/apps/${appId}/playground`} className={classes.titleLink}>
                    <Rocket size={14} />
                    Playground
                </Link>
            </div>

            <div>
                <Table className="ph-no-capture" columns={columns} dataSource={[]} />
            </div>
        </div>
    )
}

export default VariantsOverview
