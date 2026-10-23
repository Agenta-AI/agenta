import {Html, Head, Main, NextScript} from "next/document"
import Script from "next/script"

// Runs synchronously before paint to apply the persisted theme, preventing a
// flash of the wrong theme on load. Same localStorage key as the desktop app
// ("agenta-theme", JSON-encoded by usehooks-ts, default "system") so the
// user's theme follows them between /m and the desktop app.
const themeInitScript = `(function(){try{var r=localStorage.getItem('agenta-theme');var m=r?(r.charAt(0)==='"'?JSON.parse(r):r):'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`

export default function Document() {
    return (
        <Html lang="en" className="antialiased">
            <Head>
                {/* Own copies under public/, not a reach into the desktop app's /assets: the
                    mobile image ships standalone and must not 404 its own icon wherever the
                    desktop is not deployed. The `/m` prefix is written out because basePath is
                    not applied to a bare href here, same as the __env.js script below. */}
                <link rel="icon" href="/m/assets/favicon.ico" sizes="any" />
                <link rel="icon" href="/m/assets/agenta-symbol.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/m/assets/agenta-symbol.svg" />
                {/* The website's card: og:image must be absolute, and this app's host is only known at runtime. */}
                <meta property="og:type" content="website" />
                <meta property="og:site_name" content="Agenta" />
                <meta property="og:title" content="Agenta" />
                <meta
                    property="og:description"
                    content="The open-source, no-code agent workspace."
                />
                <meta property="og:image" content="https://agenta.ai/og/default.png" />
                <meta property="og:image:width" content="2000" />
                <meta property="og:image:height" content="1050" />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:image" content="https://agenta.ai/og/default.png" />
                <script dangerouslySetInnerHTML={{__html: themeInitScript}} />
            </Head>
            <body>
                <Main />
                <NextScript />
                {/* Runtime config written by web/entrypoint.sh on container start.
                    basePath is NOT auto-applied to next/script src, hence "/m". */}
                <Script src="/m/__env.js" strategy="beforeInteractive" />
            </body>
        </Html>
    )
}
