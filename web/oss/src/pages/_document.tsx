import {Html, Head, Main, NextScript} from "next/document"
import Script from "next/script"

export default function Document() {
    return (
        <Html lang="en" className="antialiased">
            <Head />

            <body>
                <Main />
                <NextScript />
                <Script src="/__env.js" strategy="beforeInteractive" />
            </body>
        </Html>
    )
}
