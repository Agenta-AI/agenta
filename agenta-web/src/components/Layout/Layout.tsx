import React, {useEffect, useMemo, useState} from "react"
import {Breadcrumb, Button, ConfigProvider, Dropdown, Layout, Space, Tooltip, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {useAppTheme} from "./ThemeContextProvider"
import {useElementSize} from "usehooks-ts"
import {createUseStyles} from "react-jss"
import NoSSRWrapper from "../NoSSRWrapper/NoSSRWrapper"
import {ErrorBoundary} from "react-error-boundary"
import ErrorFallback from "./ErrorFallback"
import {fetchData} from "@/lib/services/api"
import {useAppsData} from "@/contexts/app.context"
import {useRouter} from "next/router"
import Image from "next/image"
import moonIcon from "@/media/night.png"
import sunIcon from "@/media/sun.png"

const {Content, Footer} = Layout

type StyleProps = {
    themeMode: "dark" | "light"
    footerHeight: number
}

const useStyles = createUseStyles({
    layout: ({themeMode}: StyleProps) => ({
        display: "flex",
        background: themeMode === "dark" ? "#141414" : "#ffffff",
        height: "100%",
        minHeight: "100vh",
        position: "relative",
    }),
    content: ({footerHeight}: StyleProps) => ({
        height: `calc(100% - ${footerHeight ?? 0}px)`,
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        marginLeft: 225,
        marginBottom: `calc(2rem + ${footerHeight ?? 0}px)`,
        flex: 1,
    }),
    breadcrumbContainer: {
        justifyContent: "space-between",
        width: "100%",
    },
    breadcrumb: {
        padding: "24px 0",
    },
    star: ({themeMode}: StyleProps) => ({
        display: "flex",
        alignItems: "center",
        padding: 0,
        height: 30,
        borderWidth: 2,
        borderColor: themeMode === "dark" ? "#333" : "#dfdfdf",
        "& div:nth-of-type(1)": {
            display: "flex",
            alignItems: "center",
            height: "100%",
            width: "100%",
            gap: 8,
            padding: "0 10px",
            background: themeMode === "dark" ? "#333" : "#dfdfdf",
            borderTopLeftRadius: 3,
            borderBottomLeftRadius: 3,
        },
        "& div:nth-of-type(2)": {
            padding: "0 15px",
        },
    }),
    joinBtn: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        "& span": {
            display: "block",
        },
        "& img": {
            width: "15px",
        },
    },
    footer: {
        position: "absolute",
        bottom: 0,
        left: 225,
        right: 0,
        textAlign: "center",
        padding: "5px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    footerLeft: {
        fontSize: 18,
    },
    footerLinkIcon: ({themeMode}: StyleProps) => ({
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    topRightBar: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        "& >span": {
            cursor: "pointer",
            marginTop: 3,
        },
    },
})

type LayoutProps = {
    children: React.ReactNode
}

const App: React.FC<LayoutProps> = ({children}) => {
    const {appTheme, themeMode, toggleAppTheme} = useAppTheme()
    const {currentApp} = useAppsData()
    const capitalizedAppName = renameVariablesCapitalizeAll(currentApp?.app_name || "")
    const [footerRef, {height: footerHeight}] = useElementSize()
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const [starCount, setStarCount] = useState(0)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isDarkTheme = appTheme === "dark"

    const isAppRoute = useMemo(
        () => router.pathname.startsWith("/apps/[app_id]"),
        [router.pathname],
    )

    useEffect(() => {
        const githubRepo = async () => {
            try {
                fetchData("https://api.github.com/repos/Agenta-AI/agenta").then((resp) => {
                    setStarCount(resp.stargazers_count)
                })
            } catch (error) {
                console.log(error)
            }
        }
        githubRepo()
    }, [])

    useEffect(() => {
        const body = document.body
        body.classList.remove("dark-mode", "light-mode")
        if (isDarkTheme) {
            body.classList.add("dark-mode")
        } else {
            body.classList.add("light-mode")
        }
    }, [appTheme])

    // wait unitl we have the app id, if its an app route
    if (isAppRoute && !appId) return null

    return (
        <NoSSRWrapper>
            {typeof window === "undefined" ? null : (
                <ConfigProvider
                    theme={{
                        algorithm: isDarkTheme ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    }}
                >
                    <Layout hasSider className={classes.layout}>
                        <Sidebar />
                        <Content className={classes.content}>
                            <Space className={classes.breadcrumbContainer}>
                                <Breadcrumb
                                    className={classes.breadcrumb}
                                    items={[
                                        {title: <Link href="/apps">Apps</Link>},
                                        {title: capitalizedAppName},
                                    ]}
                                />
                                <div className={classes.topRightBar}>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            items: [
                                                {
                                                    key: "system",
                                                    label: "System",
                                                    onClick: () => toggleAppTheme("system"),
                                                },
                                                {
                                                    key: "light",
                                                    label: "Light",
                                                    onClick: () => toggleAppTheme("light"),
                                                },
                                                {
                                                    key: "dark",
                                                    label: "Dark",
                                                    onClick: () => toggleAppTheme("dark"),
                                                },
                                            ],
                                            selectedKeys: [themeMode],
                                        }}
                                    >
                                        <a onClick={(e) => e.preventDefault()}>
                                            <Tooltip title="Change theme">
                                                <Image
                                                    alt={`Curren Theme: ${
                                                        isDarkTheme ? "dark" : "light"
                                                    }`}
                                                    src={isDarkTheme ? sunIcon : moonIcon}
                                                    width={24}
                                                    height={24}
                                                />
                                            </Tooltip>
                                        </a>
                                    </Dropdown>
                                    <Button
                                        href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA"
                                        target="_blank"
                                        className={classes.joinBtn}
                                    >
                                        <img src="/assets/slack.png" alt="Slack Image" />
                                        <span>Join us</span>
                                    </Button>
                                    {/* <Button
                                        className={classes.star}
                                        href="https://github.com/Agenta-AI/agenta"
                                    >
                                        <div>
                                            <GithubFilled style={{fontSize: 18}} />
                                            <p>Star</p>
                                        </div>
                                        <div>{starCount || 0}</div>
                                    </Button> */} */}
                                </div>
                            </Space>
                            <ErrorBoundary FallbackComponent={ErrorFallback}>
                                {children}
                            </ErrorBoundary>
                        </Content>
                        <Footer ref={footerRef} className={classes.footer}>
                            <Space className={classes.footerLeft} size={10}>
                                <Link href={"https://github.com/Agenta-AI/agenta"} target="_blank">
                                    <GithubFilled className={classes.footerLinkIcon} />
                                </Link>
                                <Link
                                    href={"https://www.linkedin.com/company/agenta-ai/"}
                                    target="_blank"
                                >
                                    <LinkedinFilled className={classes.footerLinkIcon} />
                                </Link>
                                <Link href={"https://twitter.com/agenta_ai"} target="_blank">
                                    <TwitterOutlined className={classes.footerLinkIcon} />
                                </Link>
                            </Space>
                            <div>Copyright © {new Date().getFullYear()} | Agenta.</div>
                        </Footer>
                    </Layout>
                </ConfigProvider>
            )}
        </NoSSRWrapper>
    )
}

export default App
