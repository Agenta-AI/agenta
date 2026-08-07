/** Every method is disabled by env — say so instead of showing an empty card. */
export const NoAuthMethods = () => (
    <p className="text-muted-foreground text-center text-xs">
        No sign-in method is enabled on this deployment. Contact your administrator.
    </p>
)
