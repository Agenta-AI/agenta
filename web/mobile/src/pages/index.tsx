import Head from "next/head"

// Placeholder route shell: proves the scaffold end to end (basePath, Tailwind
// v4, palette-bridged tokens, dark mode). Replaced in WP2 by context
// resolution (last-used workspace/project) + redirect to the sessions list.
// The footer link is the WP5 gate escape hatch: a plain <a> (next/link would
// prefix the /m basePath) to a desktop URL carrying ?view=desktop, which the
// desktop middleware turns into the agenta-mobile-optout cookie.
export default function Home() {
    return (
        <>
            <Head>
                <title>Agenta Mobile</title>
            </Head>
            <div className="flex min-h-dvh flex-col bg-background text-foreground">
                <main className="flex grow flex-col items-center justify-center gap-2 p-6">
                    <h1 className="text-2xl font-semibold">Agenta Mobile</h1>
                    <p className="text-muted-foreground text-sm">
                        Foundation scaffold is alive under <code>/m</code>.
                    </p>
                </main>
                <footer className="pb-8 text-center">
                    <a
                        href="/w?view=desktop"
                        className="text-muted-foreground text-sm underline underline-offset-4"
                    >
                        View desktop site
                    </a>
                </footer>
            </div>
        </>
    )
}
