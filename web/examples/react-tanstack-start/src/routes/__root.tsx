/**
 * Root route — required by TanStack Router for SSR. Wraps the entire
 * app in a minimal HTML shell. TanStack Start (not Next.js) — the
 * `<head>` element + `<HeadContent />` / `<Scripts />` composition is
 * the framework-mandated shell, NOT a Next.js head-element antipattern.
 */

/* eslint-disable @next/next/no-head-element -- TanStack Start, not Next.js */

import {createRootRoute, HeadContent, Outlet, Scripts} from "@tanstack/react-router"

export const Route = createRootRoute({
    head: () => ({
        meta: [
            {charSet: "utf-8"},
            {name: "viewport", content: "width=device-width, initial-scale=1"},
            {title: "TanStack Start Spike (raw OTel)"},
        ],
    }),
    component: RootComponent,
})

function RootComponent(): React.ReactElement {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body style={{margin: 0, fontFamily: "system-ui"}}>
                <Outlet />
                <Scripts />
            </body>
        </html>
    )
}
