import React, {useEffect, useMemo, useState} from "react"
import {Breadcrumb, Button, ConfigProvider, Layout, Space, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {useAppTheme} from "./ThemeContextProvider"
import {useElementSize} from "usehooks-ts"
import {createUseStyles} from "react-jss"
import NoSSRWrapper from "../NoSSRWrapper/NoSSRWrapper"
import {ErrorBoundary} from "react-error-boundary"
import ErrorFallback from "./ErrorFallback"
import {fetchData} from "@/lib/services/api"

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
})

type LayoutProps = {
    children: React.ReactNode
}

const App: React.FC<LayoutProps> = ({children}) => {
    const router = useRouter()
    const {app_name: appName} = router.query
    const {appTheme} = useAppTheme()
    const capitalizedAppName = renameVariablesCapitalizeAll(appName?.toString() || "")
    const [footerRef, {height: footerHeight}] = useElementSize()
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const [starCount, setStarCount] = useState(0)

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
        if (appTheme === "dark") {
            body.classList.add("dark-mode")
        } else {
            body.classList.add("light-mode")
        }
    }, [appTheme])

    const computePlaygroundBreadCrumbs = () => {
        const playground = `/playground`
        if (router?.pathname?.includes(playground)) {
            const {app_name, variant_name} = router.query
            return [
                {title: <Link href="/apps">Apps</Link>},
                {title: <Link href={`/apps/${app_name}/playground`}>Playground</Link>},
                {
                    title:
                        variant_name &&
                        renameVariablesCapitalizeAll(decodeURI(variant_name as string)),
                },
            ]
        }

        return [{title: <Link href="/apps">Apps</Link>}, {title: capitalizedAppName}]
    }

    const breadCrumbItems = useMemo(computePlaygroundBreadCrumbs, [router])

    return (
        <NoSSRWrapper>
            {typeof window === "undefined" ? null : (
                <ConfigProvider
                    theme={{
                        algorithm:
                            appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    }}
                >
                    <Layout hasSider className={classes.layout}>
                        <Sidebar />
                        <Content className={classes.content}>
                            <Space className={classes.breadcrumbContainer}>
                                <Breadcrumb
                                    className={classes.breadcrumb}
                                    items={breadCrumbItems}
                                />
                                <Button
                                    className={classes.star}
                                    href="https://github.com/Agenta-AI/agenta"
                                >
                                    <div>
                                        <GithubFilled style={{fontSize: 18}} />
                                        <p>Star</p>
                                    </div>
                                    <div>{starCount || 0}</div>
                                </Button>
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
