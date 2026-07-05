import {Button} from "@agenta/primitive-ui/components/button"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Form} from "antd"
import dynamic from "next/dynamic"

import {ConfigureProviderDrawerProps} from "./assets/types"

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
                    <Button onClick={onClose} variant="outline">
                        Cancel
                    </Button>
                    <Button onClick={() => form.submit()}>Submit</Button>
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
