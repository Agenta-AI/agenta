/**
 * The Claude token as a view (F11 f10): "Paste a token to run agents on your Pro or Max plan."
 * and the three numbered steps in a card, with "Connect" and "Cancel" inside it. "Connect" is on
 * only for a setup token (`sk-ant-oat…`) and reads "Checking…" while the token is stored; then
 * the stack goes back. A
 * connected subscription opens to its status with "Replace token".
 *
 * For an organization subscription the view also offers "Projects that can use it". A new
 * connection is created with the chosen projects; on a saved one, Save writes a changed choice,
 * after the token when one is typed.
 */
import {useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
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

const SubscriptionTokenViewBody = ({params, nav}: ViewProps<SubscriptionViewParams>) => {
    const t = useT(subscriptionSignInCatalog, providerListCatalog, commonCatalog)
    const {connection, organization} = useSubscriptionViewConnection(params)
    const editProjects = !!organization && !organization.readOnly
    const draft = useOrganizationProjectsDraft({
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
    const [saving, setSaving] = useState(false)
    const valid = typed ? token.canSubmit : draft.changed
    const saveLabel =
        typed || !draft.changed
            ? t("entityUi.subscriptionSignIn.connect")
            : t("entityUi.subscriptionSignIn.done")
    const save = async () => {
        if (typed && !(await token.submit())) return false
        return draft.apply()
    }

    // The view draws no action row (`actionRow: false`); the form still guards leaving, and the
    // unsaved-changes dialog saves through it.
    useViewForm({
        dirty: typed || draft.changed,
        valid,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel,
        savingLabel: typed ? t("entityUi.subscriptionSignIn.checking") : undefined,
        save,
    })

    // Connect and Cancel sit in the card (F11 f10): Connect first, as the primary action.
    const connect = async () => {
        if (!valid || saving) return
        setSaving(true)
        try {
            if (await save()) nav.cancel()
        } finally {
            setSaving(false)
        }
    }
    const actions = (
        <div className="flex items-center gap-2">
            <Button size="compact" disabled={!valid || saving} onClick={() => void connect()}>
                {saving && typed ? t("entityUi.subscriptionSignIn.checking") : saveLabel}
            </Button>
            <Button variant="outline" size="compact" disabled={saving} onClick={() => nav.cancel()}>
                {t("common.cancel")}
            </Button>
        </div>
    )

    // F11 f10: a bordered card with the name and its line, and the steps in a gray inner card,
    // as the ChatGPT sign-in card draws it.
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-3.5">
            <section className="flex flex-col gap-2.5 rounded-lg border border-solid border-colorBorderSecondary p-3 text-[13px]">
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-colorText">{name}</span>
                    <span className="text-colorTextSecondary">
                        {connected
                            ? t("entityUi.subscriptionSignIn.agentsCanRun")
                            : t("entityUi.subscriptionSignIn.pasteToken")}
                    </span>
                </div>
                {connected ? (
                    <div className="flex flex-col items-start gap-3">
                        <span className="flex items-center gap-2 text-colorSuccess">
                            <CheckCircle size={16} weight="fill" />
                            {t("entityUi.subscriptionSignIn.readyPickModel", {name})}
                        </span>
                        <Button variant="outline" size="compact" onClick={token.replace}>
                            {t("entityUi.subscriptionSignIn.replaceToken")}
                        </Button>
                        {actions}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 rounded-lg bg-colorFillQuaternary p-3">
                        <SubscriptionTokenSteps token={token} submitOnEnter={false} />
                        {/* Lines up with the step text: a 24 px number and a 12 px gap. */}
                        <div className="pl-9">{actions}</div>
                    </div>
                )}
            </section>
            {editProjects && organization ? (
                <SubscriptionProjectsBlock organization={organization} draft={draft} />
            ) : null}
        </div>
    )
}

export default SubscriptionTokenViewBody
