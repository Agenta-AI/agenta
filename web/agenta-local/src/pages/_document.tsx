import {Head, Html, Main, NextScript} from "next/document"

const themeBoot = `(function(){try{var v=localStorage.getItem('agenta-theme');v=v&&v.charAt(0)==='"'?JSON.parse(v):v;var d=v==='dark'||(v!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`

export default function Document() {
    return (
        <Html lang="en" suppressHydrationWarning>
            <Head />
            <body>
                <script dangerouslySetInnerHTML={{__html: themeBoot}} />
                <Main />
                <NextScript />
            </body>
        </Html>
    )
}
