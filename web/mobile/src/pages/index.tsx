import Head from "next/head"

// Placeholder route shell: proves the scaffold end to end (basePath, Tailwind
// v4, palette-bridged tokens, dark mode). Replaced in WP2 by context
// resolution (last-used workspace/project) + redirect to the sessions list.
export default function Home() {
    return (
        <>
            <Head>
                <title>Agenta Mobile</title>
            </Head>
            <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-background p-6 text-foreground">
                <h1 className="text-2xl font-semibold">Agenta Mobile</h1>
                <p className="text-muted-foreground text-sm">
                    Foundation scaffold is alive under <code>/m</code>.
                </p>
            </main>
        </>
    )
}
