/**
 * @agenta/auth-ui — the sign-in surface's building blocks, extracted from the OSS design
 * (auth.css carries the scoped brand tokens, light + dark). Plain elements only; flows run
 * on @agenta/auth; anything app-specific (post-auth redirect, provider transport, the
 * "Learn more" modal) arrives through props. The forms take their security check through
 * the neutral AuthSecurityAdapter; the one adapter both apps use — Cloudflare Turnstile,
 * which the EE API demands on every auth POST — lives here too, so the desktop and /m send
 * the same token the same way. The 404 page lives here as well — the other surface a
 * signed-out visitor lands on, built from the same scoped tokens. Import
 * "@agenta/auth-ui/auth.css" once per app and wrap the surface in `.auth-redesign`.
 */
export type {AuthMessage, AuthSecurityAdapter, AuthSuccessPayload} from "./types"
export {ShowErrorMessage} from "./ShowErrorMessage"
export {AuthDivider} from "./AuthDivider"
export {default as AuthSideBanner} from "./AuthSideBanner"
export {AuthShell, type AuthShellProps} from "./AuthShell"
export {AgentaMark, AgentaWordmark} from "./AgentaBrand"
export {NotFoundScreen, type NotFoundScreenProps} from "./NotFoundScreen"
export {
    useSignInFlow,
    type SignInFlow,
    type SignInStage,
    type UseSignInFlowOptions,
} from "./useSignInFlow"
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
export {TurnstileWidget, type TurnstileWidgetHandle} from "./TurnstileWidget"
export {useTurnstileSecurity} from "./useTurnstileSecurity"
export {RegionSelector, RegionInfoText, type RegionSelectorProps} from "./RegionSelector"
export {useRegionSelector} from "./useRegionSelector"
