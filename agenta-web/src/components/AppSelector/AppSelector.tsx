import {useState} from "react"
import {useRouter} from "next/router"
import {Input, Modal, ConfigProvider, theme, Spin} from "antd"
import useSWR from "swr"
import AppCard from "./AppCard"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {CloseCircleFilled} from "@ant-design/icons"
import TipsAndFeatures from "./TipsAndFeatures"
import Welcome from "./Welcome"

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
                    <Welcome onCreateAppClick={showAddModal} />
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
