import {Html, Head, Main, NextScript} from "next/document"
import Script from "next/script"

// Runs synchronously before paint to apply the persisted theme, preventing a
// flash of the wrong theme on load. Mirrors ThemeContextProvider's resolution:
// stored "agenta-theme" (JSON-encoded by usehooks-ts), default "system", which
// follows the OS preference.
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
                <Script src="/__env.js" strategy="beforeInteractive" />
            </body>
        </Html>
    )
}
