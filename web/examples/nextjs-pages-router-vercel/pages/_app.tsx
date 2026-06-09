/**
 * Pages Router root component.
 *
 * Pages Router requires a custom App component (instead of App Router's
 * layout.tsx). Nothing fancy — just renders the page.
 */

import type {AppProps} from "next/app"

export default function MyApp({Component, pageProps}: AppProps): React.ReactElement {
    return <Component {...pageProps} />
}
