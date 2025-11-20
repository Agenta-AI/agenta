import {ComponentProps, ReactNode, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Divider, Drawer, Space, Tag, Typography} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useAppId} from "@/oss/hooks/useAppId"
import {JSSTheme} from "@/oss/lib/Types"

import {DeploymentRevisionWithVariant} from "../.."
import VariantDetailsRenderer from "../../assets/VariantDetailsRenderer"

type DeploymentsDrawerProps = {
    mainContent: ReactNode
    headerContent?: ReactNode
    expandable?: boolean
    initialWidth?: number
    mainContentClassName?: string
    selectedRevisionRow?: DeploymentRevisionWithVariant
} & ComponentProps<typeof Drawer>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
    subTitle: {
        fontSize: theme.fontSize,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeight,
    },
    drawerContainer: {
        "& .ant-drawer-body": {
            padding: 0,
        },
    },
}))

const DeploymentsDrawer = ({
    mainContent,
    headerContent,
    expandable = true,
    initialWidth = 1200,
    mainContentClassName = "",
    selectedRevisionRow,
    ...props
}: DeploymentsDrawerProps) => {
    const appId = useAppId()
    const router = useRouter()
    const classes = useStyles()
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    return (
        <EnhancedDrawer
            closeIcon={null}
            destroyOnHidden
            width={drawerWidth}
            className={classes.drawerContainer}
            title={
                <div className="flex items-center justify-between gap-3">
                    <Button
                        onClick={() => props.onClose?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />

                    {expandable && (
                        <Button
                            onClick={() => {
                                if (drawerWidth === initialWidth) {
                                    setDrawerWidth(1920)
                                } else {
                                    setDrawerWidth(initialWidth)
                                }
                            }}
                            type="text"
                            icon={
                                drawerWidth === initialWidth ? (
                                    <FullscreenOutlined />
                                ) : (
                                    <FullscreenExitOutlined />
                                )
                            }
                        />
                    )}

                    <div className={`flex-1 ${classes.title}`}>{headerContent}</div>
                </div>
            }
            {...props}
        >
            <div className="flex h-full">
                <div className={`flex-1 overflow-auto ${mainContentClassName}`}>
                    <div
                        className={clsx([
                            "[&_.ant-tabs-nav]:sticky",
                            "[&_.ant-tabs-nav]:px-4",
                            "[&_.ant-tabs-nav]:-top-[25px]",
                            "[&_.ant-tabs-nav]:bg-white",
                            "[&_.ant-tabs-nav]:z-[1]",
                            "[&_.ant-tabs-nav]:m-0",
                            "[&_.ant-tabs-content-holder]:p-4",
                            "h-full",
                            "[&_.ant-tabs]:h-full",
                            "[&_.ant-tabs-content]:h-full",
                            "[&_.ant-tabs-tabpane]:h-full",
                        ])}
                    >
                        {mainContent}
                    </div>
                </div>
                {selectedRevisionRow && (
                    <>
                        <Divider type="vertical" className="h-full m-0" />
                        <div className={`w-[280px] overflow-auto flex flex-col gap-4 p-4`}>
                            <Typography.Text className={classes.title}>Details</Typography.Text>

                            <div className="flex flex-col">
                                <Typography.Text className={classes.subTitle}>
                                    Variant
                                </Typography.Text>

                                <Space className="w-full items-center justify-between">
                                    <VariantDetailsRenderer record={selectedRevisionRow} />

                                    {selectedRevisionRow.variant && (
                                        <Button
                                            type="default"
                                            onClick={() =>
                                                router.push({
                                                    pathname: `/apps/${appId}/playground`,
                                                    query: {
                                                        revisions: JSON.stringify([
                                                            selectedRevisionRow.variant?.id,
                                                        ]),
                                                    },
                                                })
                                            }
                                            icon={<ArrowSquareOut size={16} />}
                                        />
                                    )}
                                </Space>
                            </div>

                            <div className="flex flex-col">
                                <Typography.Text className={classes.subTitle}>
                                    Date modified
                                </Typography.Text>

                                <Tag bordered={false} className="w-fit bg-[#0517290f]">
                                    {selectedRevisionRow?.created_at}
                                </Tag>
                            </div>

                            <div className="flex flex-col">
                                <Typography.Text className={classes.subTitle}>
                                    Modified by
                                </Typography.Text>

                                <Tag bordered={false} className="w-fit bg-[#0517290f]">
                                    {selectedRevisionRow?.modified_by}
                                </Tag>
                            </div>

                            {selectedRevisionRow?.commit_message && (
                                <div className="flex flex-col">
                                    <Typography.Text className={classes.subTitle}>
                                        Notes
                                    </Typography.Text>

                                    <Tag bordered={false} className="w-fit bg-[#0517290f]">
                                        {selectedRevisionRow?.commit_message}
                                    </Tag>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </EnhancedDrawer>
    )
}

export default DeploymentsDrawer
