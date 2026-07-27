import Head from "next/head"

// Placeholder shell so root context resolution has a navigation target.
// T5 replaces this with the real sessions list screen.
export default function SessionsPage() {
    return (
        <>
            <Head>
                <title>Sessions</title>
            </Head>
            <div className="bg-background text-foreground flex min-h-dvh flex-col">
                <p className="text-muted-foreground grow p-6 text-center text-xs">
                    Sessions — coming in T5.
                </p>
            </div>
        </>
    )
}
