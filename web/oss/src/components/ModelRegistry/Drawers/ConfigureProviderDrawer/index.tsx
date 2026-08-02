import {useRef} from "react"

import type {CustomProviderFormHandle} from "@agenta/entity-ui/secretProvider"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"
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

const ConfigureProviderDrawer = ({
    selectedProvider,
    initialProviderKind,
    ...props
}: ConfigureProviderDrawerProps) => {
    const formRef = useRef<CustomProviderFormHandle | null>(null)

    const onClose = () => {
        formRef.current?.reset()
        props.onClose?.({} as any)
    }

    return (
        <EnhancedDrawer
            title={<ConfigureProviderDrawerTitle />}
            width={480}
            onClose={onClose}
            footer={
                <div className="flex justify-end items-center gap-2 py-2 px-3">
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="default" onClick={() => formRef.current?.submit()}>
                        Submit
                    </Button>
                </div>
            }
            {...props}
        >
            <ConfigureProviderDrawerContent
                formRef={formRef}
                selectedProvider={selectedProvider}
                initialProviderKind={initialProviderKind}
                onClose={onClose}
            />
        </EnhancedDrawer>
    )
}

export default ConfigureProviderDrawer
