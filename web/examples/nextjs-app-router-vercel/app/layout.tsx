/**
 * Minimal root layout. The spike doesn't need styling beyond inline
 * styles in each page; this layout only exists to satisfy Next 15's
 * App Router requirement that an app/ root has a layout.
 */

export const metadata = {
    title: "App Router Spike (raw OTel)",
    description: "ts-sdk-tracing Phase 2a spike app",
}

export default function RootLayout({children}: {children: React.ReactNode}): React.ReactElement {
    return (
        <html lang="en">
            <body style={{margin: 0, fontFamily: "system-ui"}}>{children}</body>
        </html>
    )
}
