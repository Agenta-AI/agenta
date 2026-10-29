/**
 * ConfigureProviderDrawer
 *
 * The "Configure provider" drawer — the add/edit flow for a custom (self-managed) provider
 * credential. Host-neutral: it is the drill-in `llmProviderConfig.openConfigureProvider` seam, so
 * both the desktop playground and `/m` open the identical surface.
 */
import {lazy, Suspense, useRef} from "react"

import type {LlmProvider} from "@agenta/shared/types"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Spinner} from "@agenta/ui/ui"
import {LinkSimple} from "@phosphor-icons/react"

import type {CustomProviderFormHandle} from "./CustomProviderForm"

// Code-split: the form pulls the whole vault-secret editor, and the drawer is opened rarely.
const CustomProviderForm = lazy(() => import("./CustomProviderForm"))

const HOW_TO_USE_URL =
    "https://agenta.ai/docs/prompt-engineering/playground/adding-custom-providers"

export interface ConfigureProviderDrawerProps {
    open: boolean
    onClose: () => void
    selectedProvider?: LlmProvider | null
    /** Pre-selects the provider kind for a NEW provider (e.g. from a rail "Add Bedrock" row). */
    initialProviderKind?: string
}

const ConfigureProviderDrawerTitle = () => (
    <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Configure provider</span>
        <Button variant="link" size="sm" asChild>
            <a href={HOW_TO_USE_URL} target="_blank" rel="noreferrer" className="no-underline">
                <LinkSimple size={14} />
                How to use
            </a>
        </Button>
    </div>
)

export const ConfigureProviderDrawer = ({
    open,
    onClose,
    selectedProvider,
    initialProviderKind,
}: ConfigureProviderDrawerProps) => {
    const formRef = useRef<CustomProviderFormHandle | null>(null)

    const handleClose = () => {
        formRef.current?.reset()
        onClose()
    }

    return (
        <EnhancedDrawer
            open={open}
            title={<ConfigureProviderDrawerTitle />}
            width={480}
            onClose={handleClose}
            footer={
                <div className="flex justify-end items-center gap-2 py-2 px-3">
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button variant="default" onClick={() => formRef.current?.submit()}>
                        Submit
                    </Button>
                </div>
            }
        >
            <Suspense fallback={<Spinner className="m-4" />}>
                <CustomProviderForm
                    formRef={formRef}
                    selectedProvider={selectedProvider}
                    initialProviderKind={initialProviderKind}
                    onClose={handleClose}
                />
            </Suspense>
        </EnhancedDrawer>
    )
}

export default ConfigureProviderDrawer
