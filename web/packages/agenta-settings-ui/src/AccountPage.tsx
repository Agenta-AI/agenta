import {useState} from "react"

import {richText} from "@agenta/i18n"
import {useT} from "@agenta/i18n/settings"
import {Button, Input} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"

import {SettingsRow, SettingsSection} from "./shared/SettingsSection"

export interface AccountPageProps {
    username?: string | null
    email?: string | null
    /**
     * Runs the deletion. Omit — with `renderConfirm` — on a host that cannot delete accounts
     * (it is an EE capability), and the page renders identity only rather than a dead button.
     */
    onDeleteAccount?: () => void | Promise<void>
    deleting?: boolean
    /**
     * The host's confirm dialog. Deletion is irreversible and each app confirms in its own
     * idiom, so the page owns the typed-email gate and hands over a ready dialog body.
     */
    renderConfirm?: (args: {
        open: boolean
        onClose: () => void
        onConfirm: () => void
        /** True once the typed value matches the account email. */
        confirmed: boolean
        body: React.ReactNode
    }) => React.ReactNode
}

const Field = ({
    label,
    value,
    hint,
    mono,
}: {
    label: string
    value: string
    hint: string
    mono?: boolean
}) => (
    <SettingsRow
        title={label}
        description={hint}
        control={
            <Input
                value={value}
                disabled
                aria-label={label}
                className={mono ? "w-[280px] max-w-full font-mono" : "w-[280px] max-w-full"}
            />
        }
    />
)

const DangerCallout = ({children}: {children: React.ReactNode}) => {
    const t = useT()
    return (
        <div className="flex flex-col gap-1 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg px-4 py-3">
            <span className="font-medium text-colorError">
                {t("settings.account.cannotBeUndone")}
            </span>
            <p className="m-0 text-colorText">{children}</p>
        </div>
    )
}

/**
 * The Account tab: read-only identity, then account deletion behind a typed-email gate.
 *
 * Username and email are read-only by design — set at sign-up, and the email is the sign-in
 * identity. The gate lives here so no host can ship a one-click delete by accident.
 */
export const AccountPage = ({
    username,
    email,
    onDeleteAccount,
    deleting = false,
    renderConfirm,
}: AccountPageProps) => {
    const t = useT()
    const [open, setOpen] = useState(false)
    const [typed, setTyped] = useState("")

    // Narrowed as a pair: the section and its dialog are meaningless apart, and this keeps
    // both call sites free of non-null assertions.
    const deletion = onDeleteAccount && renderConfirm ? {onDeleteAccount, renderConfirm} : null
    const address = email ?? ""
    const confirmed = Boolean(address) && typed.trim() === address

    const close = () => {
        if (deleting) return
        setOpen(false)
        setTyped("")
    }

    return (
        <div className="flex flex-col gap-8">
            <SettingsSection title={t("settings.account.profile")}>
                <Field
                    label={t("settings.account.username")}
                    value={username ?? ""}
                    hint={t("settings.account.usernameHint")}
                />
                <Field
                    mono
                    label={t("settings.account.email")}
                    value={address}
                    hint={t("settings.account.emailHint")}
                />
            </SettingsSection>

            {deletion ? (
                <SettingsSection title={t("settings.account.dangerZone")} danger>
                    <SettingsRow
                        title={t("settings.account.deleteAccount")}
                        description={t("settings.account.deleteAccountDescription")}
                        control={
                            <Button
                                variant="destructive"
                                disabled={!address}
                                onClick={() => setOpen(true)}
                            >
                                <Trash size={14} />
                                {t("settings.account.deleteAccount")}
                            </Button>
                        }
                    />
                </SettingsSection>
            ) : null}

            {deletion
                ? deletion.renderConfirm({
                      open,
                      onClose: close,
                      onConfirm: () => void deletion.onDeleteAccount(),
                      confirmed,
                      body: (
                          <div className="flex flex-col gap-3">
                              <DangerCallout>{t("settings.account.deleteCallout")}</DangerCallout>
                              <div className="flex flex-col gap-2">
                                  <div className="flex flex-wrap items-center gap-2 text-colorText">
                                      {richText(
                                          t("settings.account.typeToConfirm", {email: address}),
                                          {
                                              code: (text) => (
                                                  <code className="rounded border border-solid border-colorErrorBorder bg-colorErrorBg px-1 text-colorError">
                                                      {text}
                                                  </code>
                                              ),
                                          },
                                      )}
                                  </div>
                                  <Input
                                      autoFocus
                                      value={typed}
                                      onChange={(event) => setTyped(event.target.value)}
                                      placeholder={t("settings.account.yourEmail")}
                                      autoComplete="off"
                                      spellCheck={false}
                                  />
                              </div>
                          </div>
                      ),
                  })
                : null}
        </div>
    )
}
