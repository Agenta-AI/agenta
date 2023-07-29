import React, {useEffect, useState} from "react"
import {useRouter} from "next/router"
import {
    RocketOutlined,
    AppstoreOutlined,
    DatabaseOutlined,
    CloudUploadOutlined,
    BarChartOutlined,
    LineChartOutlined,
    QuestionOutlined,
    UserOutlined
} from "@ant-design/icons"
import {Avatar, Layout, Menu, MenuProps, Space, Tag, Tooltip, theme} from "antd"

import Logo from "../Logo/Logo"

const {Sider} = Layout

const Sidebar: React.FC = () => {
    const router = useRouter()
    const {app_name} = router.query

    const pathSegments = router.asPath.split("/")
    const page_name = pathSegments[3]

    const {
        token: {colorBgContainer},
    } = theme.useToken()

    let initialSelectedKeys: string[] = []
    if (typeof page_name === "string") {
        initialSelectedKeys = [page_name]
    } else if (Array.isArray(page_name)) {
        initialSelectedKeys = page_name
    } else if (typeof page_name === "undefined") {
        initialSelectedKeys = ["apps"]
    }
    const [selectedKeys, setSelectedKeys] = useState(initialSelectedKeys)

    useEffect(() => {
        setSelectedKeys(initialSelectedKeys)
    }, [page_name])

    const navigate = (path: string) => {
        if (path === "apps") {
            router.push(`/apps`)
        } else {
            router.push(`/apps/${app_name}/${path}`)
        }
    }

    const isPageNameUndefined = typeof page_name === "undefined";
    const menuItems: MenuProps['items'] = [
        {
            key: "apps",
            icon: <AppstoreOutlined />,
            label: "App Management",
            // tooltip: "Create new applications or switch between your existing projects.",
            onClick: () => navigate("apps"),
        },
        {
            key: "playground",
            icon: <RocketOutlined />,
            label: "Playground",
            // tooltip: "Experiment with real data and optimize your parameters including prompts, methods, and configuration settings.",
            onClick: () => navigate("playground"),
        },
        {
            key: "testsets",
            icon: <DatabaseOutlined />,
            label: "Test Sets",
            // tooltip: "Create and manage testsets for evaluation purposes.",
            onClick: () => navigate("testsets"),
        },
        {
            key: "evaluations",
            icon: <LineChartOutlined />,
            label: "Evaluate",
            // tooltip: "Perform 1-to-1 variant comparisons on testsets to identify superior options.",
            onClick: () => navigate("evaluations"),
        },
        {
            key: "results",
            icon: <BarChartOutlined />,
            label: "Results",
            // tooltip: "Analyze the evaluation outcomes to determine the most effective variants.",
            onClick: () => navigate("results"),
        },
        {
            key: "endpoints",
            icon: <CloudUploadOutlined />,
            label: "Endpoints",
            // tooltip: "Monitor production logs to ensure seamless operations.",
            onClick: () => navigate("endpoints"),
        },
    ];
    const filteredMenuItems = isPageNameUndefined ? [menuItems[0]] : menuItems.slice(1);

    const BottomMenuItems: MenuProps['items'] = [
        {
            key: "help",
            icon: <QuestionOutlined />,
            label: "Help",
            // tooltip: "Create new applications or switch between your existing projects.",
            onClick: () => window.open("https://docs.agenta.ai", "_blank"),
        },
        {
            key: "user",
            icon: <Avatar size={"small"} style={{ backgroundColor: '#87d068'}} icon={<UserOutlined />} />,
            label: "Foulen",
            // tooltip: "Create new applications or switch between your existing projects.",
            onClick: () => {},
        },
    ]
    const filteredBottomMenuItems = isPageNameUndefined ? [BottomMenuItems[0]] : BottomMenuItems.slice(2)

    return (
        <Sider
            theme="light"
            style={{
                paddingLeft: "10px",
                paddingRight: "10px",
                background: colorBgContainer,
                border: "0.01px solid #ddd",
            }}
            width={225}
        >
            <div style={{display: "flex", flexDirection: "column", height: "100%"}}>
                <div
                    style={{
                        marginTop: "20px",
                        marginBottom: "20px",
                        marginRight: "20px",
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    <Logo />
                </div>
                <Menu mode="inline" selectedKeys={[page_name || "apps"]} style={{ borderRight: 0 }} items={filteredMenuItems} />

                <div style={{flex: 1}} />

                <Menu
                    mode="vertical"
                    style={{paddingBottom: 40, borderRight: 0}}
                    selectedKeys={selectedKeys}
                    items={filteredBottomMenuItems}
                />
            </div>
        </Sider>
    )
}

export default Sidebar
