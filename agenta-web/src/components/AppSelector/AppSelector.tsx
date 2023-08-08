import {useState} from "react"
import {useRouter} from "next/router"
import {Input, Space, Modal} from "antd"
import useSWR from "swr"
import AppCard from "./AppCard"

const fetcher = (...args) => fetch(...args).then((res) => res.json())

const AppSelector: React.FC = () => {
    const [newApp, setNewApp] = useState("")
    const router = useRouter()
    const [isModalOpen, setIsModalOpen] = useState(false)

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

    if (error) return <div>failed to load</div>
    if (isLoading) return <div>loading...</div>

    return (
        <div>
            <div style={{margin: "20px 20px"}}>
                <Space size={20} wrap direction="horizontal">
                    {Array.isArray(data) &&
                        data.map((app: any, index: number) => (
                            <AppCard appName={app.app_name} key={index} index={index} />
                        ))}
                </Space>
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
        </div>
    )
}

export default AppSelector
