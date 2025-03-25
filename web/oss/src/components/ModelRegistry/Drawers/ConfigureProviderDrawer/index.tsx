import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"

import {ConfigureProviderDrawerProps} from "./assets/types"
import {Button, Form} from "antd"

const ConfigureProviderDrawerContent = dynamic(
    () => import("./assets/ConfigureProviderDrawerContent"),
    {ssr: false},
)
const ConfigureProviderDrawerTitle = dynamic(
    () => import("./assets/ConfigureProviderDrawerTitle"),
    {ssr: false},
)

const ConfigureProviderDrawer = ({selectedProvider, ...props}: ConfigureProviderDrawerProps) => {
    const [form] = Form.useForm()

    const onClose = () => {
        form.resetFields()
        props.onClose?.({} as any)
    }

    return (
        <EnhancedDrawer
            title={<ConfigureProviderDrawerTitle />}
            width={480}
            onClose={onClose}
            footer={
                <div className="flex justify-end items-center gap-2 py-2 px-3">
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="primary" onClick={() => form.submit()}>
                        Submit
                    </Button>
                </div>
            }
            {...props}
        >
            <ConfigureProviderDrawerContent
                form={form}
                selectedProvider={selectedProvider}
                onClose={onClose}
            />
        </EnhancedDrawer>
    )
}

export default ConfigureProviderDrawer
