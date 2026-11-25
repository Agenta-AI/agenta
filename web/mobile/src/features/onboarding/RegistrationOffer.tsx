import {useState, type ReactNode} from "react"

import {richText, useT} from "@agenta/i18n"
import onboardingRegistrationOfferCatalog from "@agenta/i18n/catalogs/onboarding.registrationOffer"
import {Button} from "@agenta/ui/ui"

import type {RegistrationSurvey} from "../settings/licenseApi"
import {RegistrationForm} from "../settings/RegistrationForm"
import {RegistrationGains} from "../settings/RegistrationGains"
import {CONTACT_URL, FREE_KEY_DOCS_URL} from "../settings/upgradePrompt"

import {ONBOARDING_STYLE} from "./onboardingStyle"

const link = (href: string) => (text: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline">
        {text}
    </a>
)

/**
 * Register this self-hosted instance with the admin's email: what the free key unlocks, the
 * form, and Skip. A step of the onboarding flow, and the same step once after an upgrade.
 */
export const RegistrationOffer = ({
    projectId,
    email,
    survey,
    largeCompany,
    headingId,
    renderTitle,
    onSkip,
    onDone,
}: {
    projectId: string
    email: string | null
    /** The setup answers, when the survey just ran. */
    survey?: RegistrationSurvey
    /** 51 or more people: also offer to talk about Enterprise. */
    largeCompany: boolean
    headingId?: string
    /** The heading element; a dialog passes its own title. */
    renderTitle?: (title: string) => ReactNode
    onSkip: () => void
    /** Continue, after the key request went out. */
    onDone: () => void
}) => {
    const t = useT(onboardingRegistrationOfferCatalog)
    const [registered, setRegistered] = useState(false)
    const title = t("onboarding.registrationOffer.title")

    return (
        <div className="flex flex-col gap-6">
            {renderTitle ? (
                renderTitle(title)
            ) : (
                <h1 id={headingId} tabIndex={-1} className={ONBOARDING_STYLE.headingClass}>
                    {title}
                </h1>
            )}
            <RegistrationGains />
            <RegistrationForm
                projectId={projectId}
                defaultEmail={email ?? undefined}
                survey={survey}
                onRegistered={() => setRegistered(true)}
                secondary={
                    <Button type="button" variant="ghost" onClick={onSkip}>
                        {t("onboarding.registrationOffer.skip")}
                    </Button>
                }
            />
            {registered ? (
                <Button type="button" className="self-start" onClick={onDone}>
                    {t("onboarding.registrationOffer.continue")}
                </Button>
            ) : null}
            <div className="flex flex-col gap-2">
                <p className="text-muted-foreground m-0 text-xs">
                    {richText(t("onboarding.registrationOffer.keepPromise"), {
                        link: link(FREE_KEY_DOCS_URL),
                    })}
                </p>
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
            </div>
        </div>
    )
}
