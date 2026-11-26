import {useProfile} from "@agenta/entities/profile"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import contextResolver from "@agenta/i18n/catalogs/context.resolver"
import {Button} from "@agenta/ui/ui"
import {EnvelopeSimple} from "@phosphor-icons/react"

/**
 * A signed-in person with no organization: sign-up skips the personal one when the instance is
 * at its organization limit. Says who to ask, which account is signed in, and how to leave.
 */
export const NoOrganization = ({
    onCheckAgain,
    onSignOut,
}: {
    onCheckAgain: () => void
    onSignOut: () => void
}) => {
    const t = useT(contextResolver, commonCatalog)
    const {user} = useProfile()

    return (
        <div className="flex grow items-center justify-center p-6">
            <section className="bg-card ring-border flex w-full max-w-[420px] flex-col items-center gap-3 rounded-2xl px-6 py-7 text-center ring-1 ring-inset">
                <EnvelopeSimple size={28} className="text-muted-foreground" aria-hidden />
                <h1 className="text-foreground m-0 text-lg font-semibold">
                    {t("context.resolver.noOrganizationTitle")}
                </h1>
                <p className="text-muted-foreground m-0 text-[13px]">
                    {t("context.resolver.noOrganizationBody")}
                </p>
                {user?.email ? (
                    <p className="text-muted-foreground m-0 text-xs">
                        {t("context.resolver.signedInAs", {email: user.email})}
                    </p>
                ) : null}
                <div className="flex gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={onCheckAgain}>
                        {t("context.resolver.checkAgain")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={onSignOut}>
                        {t("common.signOut")}
                    </Button>
                </div>
            </section>
        </div>
    )
}
