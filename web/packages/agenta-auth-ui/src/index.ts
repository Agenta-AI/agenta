/**
 * @agenta/auth-ui — the sign-in surface's building blocks, extracted from the OSS design
 * (auth.css carries the scoped brand tokens, light + dark). Plain elements only; flows run
 * on @agenta/auth; anything app-specific (security widget, post-auth redirect, provider
 * transport) arrives through props. Import "@agenta/auth-ui/auth.css" once per app and wrap
 * the surface in `.auth-redesign`.
 */
export type {AuthMessage, AuthSecurityAdapter, AuthSuccessPayload} from "./types"
export {ShowErrorMessage} from "./ShowErrorMessage"
export {AuthDivider} from "./AuthDivider"
export {default as AuthSideBanner} from "./AuthSideBanner"
export {AuthShell, type AuthShellProps} from "./AuthShell"
export {EmailFirstForm, type EmailFirstFormProps} from "./EmailFirstForm"
export {
    SocialAuthButtons,
    type SocialAuthButtonsProps,
    type SocialProvider,
} from "./SocialAuthButtons"
export {OtpInput, type OtpInputHandle} from "./OtpInput"
export {OtpVerifyForm, type OtpVerifyFormProps} from "./OtpVerifyForm"
export {PasswordlessRequestForm, type PasswordlessRequestFormProps} from "./PasswordlessRequestForm"
export {EmailPasswordForm, type EmailPasswordFormProps} from "./EmailPasswordForm"
