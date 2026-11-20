/**
 * The Claude token as a view (F11 f10): "Paste a token to run agents on your Pro or Max plan."
 * and the three numbered steps. Save reads "Connect" and is on only for a setup token
 * (`sk-ant-oat…`); it stores the token, then the stack goes back to the list. A connected
 * subscription opens to its status with "Replace token".
 */
import {providerConnectionsAtom, subscriptionConnectionFor} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {CheckCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SubscriptionTokenSteps} from "../SubscriptionTokenSteps"
import {useSubscriptionToken} from "../useSubscriptionToken"

import type {SubscriptionViewParams} from "./subscriptionViews"

const SubscriptionTokenViewBody = ({params, nav}: ViewProps<SubscriptionViewParams>) => {
    const t = useT(subscriptionSignInCatalog, providerListCatalog)
    const connections = useAtomValue(providerConnectionsAtom)
    const connection =
        (params.connectionId
            ? connections.find((candidate) => candidate.id === params.connectionId)
            : subscriptionConnectionFor(connections, params.provider)) ?? null
    const token = useSubscriptionToken({provider: params.provider, connection})
    const {name, connected} = token
    useViewTitle(name)

    useViewForm({
        dirty: token.value.trim() !== "",
        valid: token.canSubmit,
        leaveDescription: t("entityUi.providerList.formLeaveDescription"),
        saveLabel: t("entityUi.subscriptionSignIn.connect"),
        save: token.submit,
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
                <SubscriptionTokenSteps
                    token={token}
                    // Enter stores the token like "Connect"; the stored token clears the form.
                    onSubmit={() =>
                        void token.submit().then((stored) => (stored ? nav.cancel() : undefined))
                    }
                />
            )}
        </div>
    )
}

export default SubscriptionTokenViewBody
