export default function RootLayout({children}: {children: React.ReactNode}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}

export const metadata = {
    title: "Agenta Workflow Spike",
}
