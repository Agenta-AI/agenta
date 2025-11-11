import Head from "next/head"
import Script from "next/script"

const CloudScripts = () => {
    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
                <script
                    type="text/javascript"
                    src="https://app.termly.io/embed.min.js/8e05e2f3-b396-45dd-bb76-4dfa5ce28e10?autoBlock=on"
                ></script>
            </Head>
            <div className="container">
                <Script src="/__env.js" strategy="beforeInteractive" />
                <Script src="https://www.googletagmanager.com/gtag/js?id=G-PV7R8H9KDM" />
                <Script id="google-analytics">
                    {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
 
          gtag('config', 'G-PV7R8H9KDM');
        `}
                </Script>
                <Script id="crisp-chat" strategy="afterInteractive">
                    {`
          window.$crisp=[];
          window.CRISP_WEBSITE_ID="5bba54ec-9734-4881-ac1e-a2cb3c74bbd5";
          (function(){
            d=document;
            s=d.createElement("script");
            s.src="https://client.crisp.chat/l.js";
            s.async=1;
            d.getElementsByTagName("head")[0].appendChild(s);
          })();
        `}
                </Script>
            </div>
        </>
    )
}

export default CloudScripts
