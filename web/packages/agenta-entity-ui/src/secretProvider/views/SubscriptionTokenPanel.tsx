/**
 * The Claude token as a view (F11 f10): "Paste a token to run agents on your Pro or Max plan."
 * and the three numbered steps in a card, with "Connect" and "Cancel" inside it. "Connect" is on
 * only for a setup token (`sk-ant-oat…`) and reads "Checking…" while the token is stored; then
 * the stack goes back. A connected subscription opens to its status with "Replace token".
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
import type {ViewForm} from "@agenta/ui/view-stack"
import {CheckCircle} from "@phosphor-icons/react"

import {SubscriptionTokenSteps} from "../SubscriptionTokenSteps"
import {useOrganizationProjectsDraft} from "../useOrganizationProjectsDraft"
import {useSubscriptionToken} from "../useSubscriptionToken"

import {SubscriptionProjectsBlock} from "./SubscriptionProjectsBlock"
import type {SubscriptionViewParams} from "./subscriptionViews"
import {useSubscriptionViewConnection} from "./useSubscriptionViewConnection"

export interface SubscriptionTokenPanelProps {
    params: SubscriptionViewParams
    /** The token or the project choice is saved. */
    onDone: () => void
    onCancel: () => void
    /** A host that titles itself from the name (the view stack). */
    useTitle?: (name: string) => void
    /** A host that guards leaving and saves through its own Save (the view stack). */
    useForm?: (form: ViewForm) => void
    /** Save through the host instead of here; the host leaves when it lands. */
    hostSave?: () => Promise<unknown>
    /** "footer": Cancel and Connect in a footer row at the end (a dialog); else inside the steps. */
    actionsPlacement?: "inline" | "footer"
}

const noTitle = (_name: string) => undefined
const noForm = (_form: ViewForm) => undefined

/** The Claude token: three steps and Connect; a saved one shows its status and Replace token. */
export const SubscriptionTokenPanel = ({
    params,
    onDone,
    onCancel,
    useTitle = noTitle,
    useForm = noForm,
    hostSave,
    actionsPlacement = "inline",
}: SubscriptionTokenPanelProps) => {
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
    useTitle(name)

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

    // The view draws no action row (`actionRow: false`); the form guards leaving, and Connect and
    // the unsaved-changes dialog both save through it.
    useForm({
        dirty: typed || draft.changed,
        valid,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel,
        savingLabel: typed ? t("entityUi.subscriptionSignIn.checking") : undefined,
        save,
    })

    // Connect and Cancel sit in the card: Connect first; a host's Save runs it when it has one.
    const connect = async () => {
        if (!valid || saving) return
        setSaving(true)
        try {
            if (hostSave) await hostSave()
            else if (await save()) onDone()
        } finally {
            setSaving(false)
        }
    }
    const footer = actionsPlacement === "footer"
    const connectButton = (
        <Button
            size={footer ? "default" : "compact"}
            disabled={!valid || saving}
            onClick={() => void connect()}
        >
            {saving && typed ? t("entityUi.subscriptionSignIn.checking") : saveLabel}
        </Button>
    )
    const cancelButton = (
        <Button
            variant="outline"
            size={footer ? "default" : "compact"}
            disabled={saving}
            onClick={onCancel}
        >
            {t("common.cancel")}
        </Button>
    )
    // A dialog footer reads Cancel then Connect, at its end; inline, Connect leads.
    const actions = footer ? (
        <div className="flex items-center justify-end gap-2">
            {cancelButton}
            {connectButton}
        </div>
    ) : (
        <div className="flex items-center gap-2">
            {connectButton}
            {cancelButton}
        </div>
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            {/* The host's title names the subscription, so the body starts with what to do. */}
            <section className="flex flex-col gap-4 text-label">
                <span className="text-muted-foreground">
                    {connected
                        ? t("entityUi.subscriptionSignIn.agentsCanRun")
                        : t("entityUi.subscriptionSignIn.pasteToken")}
                </span>
                {connected ? (
                    <div className="flex flex-col items-start gap-3">
                        <span className="flex items-center gap-2 text-success">
                            <CheckCircle size={16} weight="fill" />
                            {t("entityUi.subscriptionSignIn.readyPickModel", {name})}
                        </span>
                        <Button variant="outline" size="compact" onClick={token.replace}>
                            {t("entityUi.subscriptionSignIn.replaceToken")}
                        </Button>
                        {/* A ready token has nothing to connect; only a changed project choice saves. */}
                        {!footer && draft.changed ? actions : null}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <SubscriptionTokenSteps token={token} submitOnEnter={false} />
                        {/* Lines up with the step text: a 24 px number and a 12 px gap. */}
                        {footer ? null : <div className="pl-9">{actions}</div>}
                    </div>
                )}
            </section>
            {editProjects && organization ? (
                <SubscriptionProjectsBlock organization={organization} draft={draft} />
            ) : null}
            {footer && (!connected || draft.changed) ? actions : null}
        </div>
    )
}

