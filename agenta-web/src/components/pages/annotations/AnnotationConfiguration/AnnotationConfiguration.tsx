import {useAppId} from "@/hooks/useAppId"
import {JSSTheme} from "@/lib/Types"
import {PlusCircleOutlined} from "@ant-design/icons"
import {Button, Space} from "antd"
import {useRouter} from "next/router"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
    },
    buttonsGroup: {
        justifyContent: "flex-end",
        width: "100%",
        padding: "1rem 0",
        position: "sticky",
        top: 46,
        zIndex: 1,
        backgroundColor: theme.colorBgContainer,
    },
}))

const AnnotationConfiguration = () => {
    const classes = useStyles()
    const appId = useAppId()
    const router = useRouter()
    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Button
                    icon={<PlusCircleOutlined />}
                    type="primary"
                    onClick={() => router.push(`/apps/${appId}/annotations/configuration`)}
                >
                    New Evaluator
                </Button>
            </Space>
        </div>
    )
}

export default AnnotationConfiguration
