import {useState} from "react"
import {useRouter} from "next/router"
import {Input, Modal, ConfigProvider, theme, Spin, Button} from "antd"
import useSWR from "swr"
import AppCard from "./AppCard"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {CloseCircleFilled} from "@ant-design/icons"
import TipsAndFeatures from "./TipsAndFeatures"

const fetcher = (...args: any[]) => fetch(...args).then((res) => res.json())

const AppSelector: React.FC = () => {
    const [newApp, setNewApp] = useState("")
    const router = useRouter()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const {appTheme} = useAppTheme()

    const showAddModal = () => {
        setIsModalOpen(true)
    }

    const handleAddOk = () => {
        setIsModalOpen(false)
    }

    const handleAddCancel = () => {
        setIsModalOpen(false)
    }

    // TODO: move to api.ts
    const {data, error, isLoading} = useSWR(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/list_apps/`,
        fetcher,
    )

    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <div
                style={{
                    maxWidth: "1000px",
                    margin: "10px auto 5%",
                    width: "100%",
                    color: appTheme === "dark" ? "#fff" : "#000",
                }}
            >
                {isLoading ? (
                    <div className="appSelectorMssg">
                        <Spin />
                        <h1>loading...</h1>
                    </div>
                ) : error ? (
                    <div className="appSelectorMssg">
                        <CloseCircleFilled style={{fontSize: 20, color: "red"}} />
                        <h1>failed to load</h1>
                    </div>
                ) : Array.isArray(data) && data.length ? (
                    <>
                        <h1
                            style={{
                                fontSize: 24,
                                borderBottom: "1px solid #0e9c1a",
                                paddingBottom: "1rem",
                            }}
                        >
                            LLM Applications
                        </h1>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 10,
                            }}
                        >
                            {Array.isArray(data) &&
                                data.map((app: any, index: number) => (
                                    <>
                                        <AppCard appName={app.app_name} key={index} index={index} />
                                    </>
                                ))}
                        </div>
                        <TipsAndFeatures />
                    </>
                ) : (
                    <>
                        <div>
                            <h1 style={{fontSize: "42px", margin: "20px 0"}}>
                                Welcome to <span style={{color: "#0e9c1a"}}>Agenta</span>
                            </h1>
                            <h2
                                style={{
                                    fontSize: "24px",
                                    margin: "20px 0",
                                    borderBottom: "1px solid #0e9c1a",
                                    paddingBottom: "1rem",
                                }}
                            >
                                The developer-first open source LLMOps platform.
                            </h2>
                        </div>
                        <div
                            style={{
                                padding: "0 20px",
                                lineHeight: 1.7,
                                marginBottom: "2rem",
                            }}
                        >
                            <p>
                                Agenta is an open-source developer first LLMOps platform to
                                streamline the process of building LLM-powered applications.
                                Building LLM-powered apps is an iterative process with lots of
                                prompt-engineering and testing multiple variants.
                                <br />
                                Agenta brings the CI/CD platform to this process by enabling you to
                                quickly iterate, experiment, evaluate, and optimize your LLM apps.
                                All without imposing any restrictions on your choice of framework,
                                library, or model.
                                <br />
                            </p>

                            <div>
                                <span
                                    style={{
                                        fontWeight: 600,
                                        fontSize: 15,
                                        textTransform: "uppercase",
                                    }}
                                >
                                    Read{" "}
                                    <a href="https://docs.agenta.ai/introduction" target="_blank">
                                        Documentation
                                    </a>{" "}
                                    on how to get started.
                                </span>
                            </div>
                        </div>
                        <div
                            className="appSelectorEmpty"
                            style={{
                                backgroundColor: appTheme === "dark" ? "#111a2c" : "#e6f4ff",
                            }}
                        >
                            <h1 style={{fontSize: 20}}>Get started creating your first LLM App</h1>

                            <p>
                                This guide assumes you have completed the installation process. If
                                not, please follow our{" "}
                                <a href="https://docs.agenta.ai/installation" target="_blank">
                                    installation guide
                                </a>
                                .
                            </p>

                            <Button
                                style={{
                                    backgroundColor: "#1677ff",
                                    border: "none",
                                    color: "#fff",
                                }}
                            >
                                Create New App
                            </Button>
                        </div>
                    </>
                )}

                <Modal
                    title="Add new app from template"
                    open={isModalOpen}
                    onOk={handleAddOk}
                    onCancel={handleAddCancel}
                >
                    <Input
                        placeholder="New app name"
                        value={newApp}
                        onChange={(e) => setNewApp(e.target.value)}
                    />
                </Modal>
            </div>
        </ConfigProvider>
    )
}

export default AppSelector
