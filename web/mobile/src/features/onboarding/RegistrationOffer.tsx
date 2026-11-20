import {useState} from "react"

import {useT} from "@agenta/i18n"
import onboardingRegistrationOfferCatalog from "@agenta/i18n/catalogs/onboarding.registrationOffer"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {RegistrationForm} from "../settings/RegistrationForm"
import {CONTACT_URL} from "../settings/upgradePrompt"

/** After the setup survey: register this self-hosted instance with the admin's email. */
export const RegistrationOffer = ({
    open,
    projectId,
    email,
    largeCompany,
    onClose,
}: {
    open: boolean
    projectId: string
    email: string | null
    /** 51 or more people: also offer to talk about Enterprise. */
    largeCompany: boolean
    onClose: () => void
}) => {
    const t = useT(onboardingRegistrationOfferCatalog)
    const [registered, setRegistered] = useState(false)

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("onboarding.registrationOffer.title")}</DialogTitle>
                    <DialogDescription>
                        {t("onboarding.registrationOffer.description")}
                    </DialogDescription>
                </DialogHeader>
                <RegistrationForm
                    projectId={projectId}
                    defaultEmail={email ?? undefined}
                    onRegistered={() => setRegistered(true)}
                    secondary={
                        <Button type="button" variant="ghost" onClick={onClose}>
                            {t("onboarding.registrationOffer.skip")}
                        </Button>
                    }
                />
                {registered ? (
                    <Button type="button" className="self-start" onClick={onClose}>
                        {t("onboarding.registrationOffer.continue")}
                    </Button>
                ) : null}
                {largeCompany ? (
                    <a
                        href={CONTACT_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground text-[13px] underline"
                    >
                        {t("onboarding.registrationOffer.talkAboutEnterprise")}
                    </a>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
