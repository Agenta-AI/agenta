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
