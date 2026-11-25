import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"
import {Button, Checkbox, Input} from "@agenta/ui/ui"
import {useMutation} from "@tanstack/react-query"

import {
    createInstanceRegistration,
    isRegistrationRefused,
    isRegistrationUnreachable,
    type RegistrationSurvey,
} from "./licenseApi"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Ask Agenta for a free key for this instance; Agenta emails it with the activation link. */
export const RegistrationForm = ({
    projectId,
    defaultEmail,
    survey,
    secondary,
    onRegistered,
}: {
    projectId: string
    defaultEmail?: string
    /** The setup answers; sent with the registration, and said so under the button. */
    survey?: RegistrationSurvey
    /** A quieter step beside the submit button, such as Skip. */
    secondary?: ReactNode
    onRegistered?: () => void
}) => {
    const t = useT(settingsLicenseCatalog)
    const [email, setEmail] = useState(defaultEmail ?? "")
    // Optional and ticked to start: the key never depends on it.
    const [productUpdates, setProductUpdates] = useState(true)
    const register = useMutation({
        mutationFn: (value: string) =>
            createInstanceRegistration(projectId, {email: value, productUpdates, survey}),
        onSuccess: () => onRegistered?.(),
    })
    const trimmed = email.trim()
    const valid = EMAIL.test(trimmed)
    const refused = register.isError && isRegistrationRefused(register.error)

    if (register.isSuccess) {
        return (
            <p role="status" className="text-foreground m-0 text-[13px]">
                {t("settings.license.registrationSent", {email: register.data.email})}
            </p>
        )
    }

    return (
        <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault()
                if (valid) register.mutate(trimmed)
            }}
        >
            <label className="flex flex-col gap-1.5">
                <span className="text-foreground text-sm font-medium">
                    {t("settings.license.registrationEmail")}
                </span>
                <Input
                    type="email"
                    value={email}
                    onChange={(event) => {
                        setEmail(event.target.value)
                        if (register.isError) register.reset()
                    }}
                    aria-invalid={refused || undefined}
                    placeholder="name@company.com"
                    autoComplete="email"
                />
                {refused ? (
                    <span role="alert" className="text-colorError text-sm">
                        {t("settings.license.registrationInvalidEmail")}
                    </span>
                ) : null}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                    checked={productUpdates}
                    onCheckedChange={(checked) => setProductUpdates(checked === true)}
                />
                <span>{t("settings.license.registrationProductUpdates")}</span>
            </label>
            {register.isError && !refused ? (
                <p role="alert" className="text-colorError m-0 text-sm">
                    {isRegistrationUnreachable(register.error)
                        ? t("settings.license.registrationUnreachable")
                        : t("settings.license.registrationSendFailed")}
                </p>
            ) : null}
            <div className="flex items-center gap-2">
                <Button type="submit" disabled={!valid || register.isPending}>
                    {register.isPending
                        ? t("settings.license.registrationSending")
                        : t("settings.license.registrationSubmit")}
                </Button>
                {secondary}
            </div>
            {survey ? (
                <p className="text-muted-foreground m-0 text-xs">
                    {t("settings.license.registrationAnswersNotice")}
                </p>
            ) : null}
        </form>
    )
}
