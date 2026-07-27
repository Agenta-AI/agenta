export const SignedOutNotice = () => (
    <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">You are signed out</p>
        <p className="text-muted-foreground text-xs">
            Sign in on the desktop app first, then reload this page.
        </p>
    </div>
)
