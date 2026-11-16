/**
 * ConfigureProviderDrawer
 *
 * The "Configure provider" drawer — the add/edit flow for a custom (self-managed) provider
 * credential. Host-neutral: it is the drill-in `llmProviderConfig.openConfigureProvider` seam, so
 * both the desktop playground and `/m` open the identical surface.
 */
import {lazy, Suspense, useRef} from "react"

import {useT} from "@agenta/i18n"
import customProviderFormCatalog from "@agenta/i18n/catalogs/entityUi.customProviderForm"
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

const ConfigureProviderDrawerTitle = () => {
    const t = useT(customProviderFormCatalog)
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
                {t("entityUi.customProviderForm.configureProvider")}
            </span>
            <Button variant="link" size="sm" asChild>
                <a href={HOW_TO_USE_URL} target="_blank" rel="noreferrer" className="no-underline">
                    <LinkSimple size={14} />
                    {t("entityUi.customProviderForm.howToUse")}
                </a>
            </Button>
        </div>
    )
}

export const ConfigureProviderDrawer = ({
    open,
    onClose,
    selectedProvider,
    initialProviderKind,
}: ConfigureProviderDrawerProps) => {
    const t = useT(customProviderFormCatalog)
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
                        {t("entityUi.customProviderForm.cancel")}
                    </Button>
                    <Button variant="default" onClick={() => formRef.current?.submit()}>
                        {t("entityUi.customProviderForm.submit")}
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
