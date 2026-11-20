import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {useProjectName} from "../../../../accounts/useProjectName"
import {
    ConnectAppMark,
    ConnectFormFields,
    useConnectForm,
} from "../../../../gatewayTool/components/ConnectForm"
import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import type {IntegrationConnectViewParams} from "./integrationConnectView"

const IntegrationConnectViewBody = ({params}: ViewProps<IntegrationConnectViewParams>) => {
    const {integration} = useToolIntegrationDetail(params.integrationKey)
    useViewTitle(integration?.name ?? params.integrationKey)
    // The form starts from the app's sign-in methods, so it waits for them.
    if (!integration) {
        return (
            <div className="px-4 py-3">
                <CatalogRowSkeleton count={1} />
            </div>
        )
    }
    return (
        <ConnectForm
            params={params}
            name={integration.name}
            logo={integration.logo}
            description={integration.description}
            authSchemes={(integration.auth_schemes as string[] | null | undefined) ?? []}
        />
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
        leaveDescription: t("entityUi.integrationViews.connectLeaveDescription"),
        saveLabel: t("entityUi.connectForm.connect"),
        save: form.submit,
    })
    return (
        <div className="flex flex-col gap-4 px-4 py-3">
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
