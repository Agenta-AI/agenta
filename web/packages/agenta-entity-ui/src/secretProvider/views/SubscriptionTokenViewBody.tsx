/**
 * The Claude token as a view (F11 f10): "Paste a token to run agents on your Pro or Max plan."
 * and the three numbered steps. Save reads "Connect", is on only for a setup token
 * (`sk-ant-oat…`) and reads "Checking…" while the token is stored; then the stack goes back. A
 * connected subscription opens to its status with "Replace token".
 *
 * For an organization subscription the view also offers "Projects that can use it". A new
 * connection is created with the chosen projects; on a saved one, Save writes a changed choice,
 * after the token when one is typed.
 */
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {CheckCircle} from "@phosphor-icons/react"

import {SubscriptionTokenSteps} from "../SubscriptionTokenSteps"
import {useOrganizationProjectsDraft} from "../useOrganizationProjectsDraft"
import {useSubscriptionToken} from "../useSubscriptionToken"

import {SubscriptionProjectsBlock} from "./SubscriptionProjectsBlock"
import type {SubscriptionViewParams} from "./subscriptionViews"
import {useSubscriptionViewConnection} from "./useSubscriptionViewConnection"

const SubscriptionTokenViewBody = ({params}: ViewProps<SubscriptionViewParams>) => {
    const t = useT(subscriptionSignInCatalog, providerListCatalog)
    const {connection, organization} = useSubscriptionViewConnection(params)
    const editProjects = !!organization && !organization.readOnly
    const draft = useOrganizationProjectsDraft({
        open: true,
        connection,
        enabled: editProjects,
        organizationName: organization?.name,
    })
    const token = useSubscriptionToken({
        provider: params.provider,
        connection,
        scope: organization ? "organization" : "project",
        projects: organization ? draft.projects : undefined,
        organizationName: organization?.name,
    })
    const {name, connected} = token
    useViewTitle(name)

    const typed = token.value.trim() !== ""

    useViewForm({
        dirty: typed || draft.changed,
        valid: typed ? token.canSubmit : draft.changed,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel:
            typed || !draft.changed
                ? t("entityUi.subscriptionSignIn.connect")
                : t("entityUi.subscriptionSignIn.done"),
        savingLabel: typed ? t("entityUi.subscriptionSignIn.checking") : undefined,
        save: async () => {
            if (typed && !(await token.submit())) return false
            return draft.apply()
        },
    })

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-colorText">{name}</span>
                <span className="text-[13px] text-colorTextSecondary">
                    {connected
                        ? t("entityUi.subscriptionSignIn.agentsCanRun")
                        : t("entityUi.subscriptionSignIn.pasteToken")}
                </span>
            </div>
            {connected ? (
                <div className="flex flex-col items-start gap-3">
                    <span className="flex items-center gap-2 text-[13px] text-colorSuccess">
                        <CheckCircle size={16} weight="fill" />
                        {t("entityUi.subscriptionSignIn.readyPickModel", {name})}
                    </span>
                    <Button variant="outline" onClick={token.replace}>
                        {t("entityUi.subscriptionSignIn.replaceToken")}
                    </Button>
                </div>
            ) : (
                <SubscriptionTokenSteps token={token} submitOnEnter={false} />
            )}
            {editProjects && organization ? (
                <SubscriptionProjectsBlock organization={organization} draft={draft} />
            ) : null}
        </div>
    )
}

export default SubscriptionTokenViewBody
