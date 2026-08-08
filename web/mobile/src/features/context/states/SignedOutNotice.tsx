import Link from "next/link"

export const SignedOutNotice = () => (
    <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-medium">Sign in to continue</p>
        <Link href="/auth" className="-m-3 p-3 text-xs underline underline-offset-4">
            Sign in
        </Link>
        <p className="text-muted-foreground text-xs">
            Already signed in on desktop? Reload this page.
        </p>
    </div>
)
