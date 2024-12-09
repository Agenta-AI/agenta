import {Card, Dropdown, Button, Typography, Tag} from "antd"
import {MoreOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"
import {JSSTheme, ListAppsItem} from "@/lib/Types"
import {Note, PencilLine, Trash} from "@phosphor-icons/react"
import {useRouter} from "next/router"
import {formatDay} from "@/lib/helpers/dateTimeHelper"

const {Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        display: "flex",
        flexDirection: "column",
        transition: "all 0.025s ease-in",
        cursor: "pointer",
        boxShadow: theme.boxShadowTertiary,
        "& > .ant-card-head": {
            minHeight: 0,
            padding: `${theme.paddingXS}px ${theme.paddingSM}px`,
            "& .ant-card-head-title": {
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
        },
        "&:hover": {
            boxShadow: theme.boxShadow,
        },
    },
    app_card_link: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        "& > div": {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
            color: theme.colorText,
        },
        "& .ant-typography": {
            fontSize: `${theme.fontSize}px !important`,
        },
    },
}))

const AppCard: React.FC<{
    app: ListAppsItem
    setSelectedApp: React.Dispatch<React.SetStateAction<ListAppsItem | null>>
    setIsDeleteAppModalOpen: (value: React.SetStateAction<boolean>) => void
    setIsEditAppModalOpen: (value: React.SetStateAction<boolean>) => void
}> = ({app, setSelectedApp, setIsDeleteAppModalOpen, setIsEditAppModalOpen}) => {
    const router = useRouter()

    const classes = useStyles()

    return (
        <>
            <Card
                className={classes.card}
                title={app.app_name}
                onClick={() => router.push(`/apps/${app.app_id}/overview`)}
                extra={
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "open_app",
                                    label: "Open",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/apps/${app.app_id}/overview`)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "rename_app",
                                    label: "Rename",
                                    icon: <PencilLine size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedApp(app)
                                        setIsEditAppModalOpen(true)
                                    },
                                },
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedApp(app)
                                        setIsDeleteAppModalOpen(true)
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
                <div data-cy="app-card-link" className={classes.app_card_link}>
                    <div>
                        <Text>Type</Text>
                        <Tag className="mr-0">{app.app_type}</Tag>
                    </div>
                    <div>
                        <Text>Last modified:</Text>
                        <Text>{formatDay(app.updated_at)}</Text>
                    </div>
                </div>
            </Card>
        </>
    )
}

export default AppCard
