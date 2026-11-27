import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {useProjectName} from "../../../../accounts/useProjectName"
import {
    ConnectAppMark,
    ConnectFormFields,
    useConnectForm,
} from "../../../../gatewayTool/components/ConnectForm"

import type {IntegrationConnectViewParams} from "./integrationConnectView"

const IntegrationConnectViewBody = ({params}: ViewProps<IntegrationConnectViewParams>) => {
    const t = useT(integrationViewsCatalog)
    const query = useAtomValue(toolIntegrationDetailQueryFamily(params.integrationKey))
    const integration = query.data?.integration ?? null
    useViewTitle(integration?.name ?? params.integrationKey)
    if (!integration && query.isError) {
        return (
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-label">
                <span className="text-muted-foreground">
                    {t("entityUi.integrationViews.appLoadError")}
                </span>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                    {t("entityUi.integrationViews.tryAgain")}
                </Button>
            </div>
        )
    }
    // The form starts from the app's sign-in methods, so it waits for them in its own shape.
    if (!integration)
        return <ConnectFormSkeleton askOwner={Boolean(params.owners && params.owners.length > 1)} />
    return (
        <ConnectForm
            params={params}
            name={integration.name}
            logo={integration.logo}
            description={params.description ?? integration.description}
            authSchemes={(integration.auth_schemes as string[] | null | undefined) ?? []}
        />
    )
}

/** The connect form's outline while the app loads: the same blocks at the same heights. */
const ConnectFormSkeleton = ({askOwner}: {askOwner: boolean}) => {
    const t = useT(integrationViewsCatalog, connectFormCatalog)
    // The action row keeps its Connect label, disabled, so it does not change when the form lands.
    useViewForm({
        dirty: false,
        valid: false,
        saveLabel: t("entityUi.connectForm.connect"),
        save: async () => false,
    })
    const line = (width: string) => (
        <span className="flex h-5 items-center">
            <SkeletonBlock className={`h-3 ${width}`} />
        </span>
    )
    return (
        <div aria-busy className="flex flex-col gap-3 px-4 py-3.5">
            <SkeletonBlock shape="mark" className="size-8" />
            <div className="flex flex-col gap-1">
                {line("w-40")}
                {line("w-full")}
            </div>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <span className="flex h-4 items-center">
                        <SkeletonBlock className="h-2.5 w-12" />
                    </span>
                    <SkeletonBlock shape="soft" className="h-control" />
                </div>
                {askOwner ? (
                    <div className="flex flex-col gap-1">
                        <span className="flex h-[18px] items-center">
                            <SkeletonBlock className="h-3 w-14" />
                        </span>
                        <SkeletonBlock shape="soft" className="h-[76px]" />
                    </div>
                ) : null}
            </div>
        </div>
    )
}

const ConnectForm = ({
    params,
    name,
    logo,
    description,
    authSchemes,
}: {
    params: IntegrationConnectViewParams
    name: string
    logo?: string | null
    description?: string | null
    authSchemes: string[]
}) => {
    const t = useT(integrationViewsCatalog, connectFormCatalog)
    const form = useConnectForm({
        integrationKey: params.integrationKey,
        integrationName: name,
        authSchemes,
        owners: params.owners,
        onCreated: params.onCreated,
    })
    const projectName = useProjectName(Boolean(params.owners && params.owners.length > 1))
    useViewForm({
        // A create form: the name is filled in from the start, so Connect works at once, and
        // leaving asks while the name field has text.
        dirty: form.valid,
        valid: form.valid,
        saveLabel: t("entityUi.connectForm.connect"),
        save: form.submit,
    })
    return (
        <div className="flex flex-col gap-3 px-4 py-3.5">
            <ConnectAppMark name={name} logo={logo} />
            <ConnectFormFields
                form={form}
                integrationName={name}
                integrationDescription={description}
                projectName={projectName}
            />
        </div>
    )
}

export default IntegrationConnectViewBody
