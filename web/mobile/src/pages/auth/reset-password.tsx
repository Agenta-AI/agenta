import {PageTitle} from "@/components/PageTitle"
import {ResetPasswordScreen} from "@/features/auth/ResetPasswordScreen"

// Thin shell: the page a member password reset link opens (`?token=` from SuperTokens).
export default function ResetPassword() {
    return (
        <>
            <PageTitle title="Set a new password" />
            <ResetPasswordScreen />
        </>
    )
}
