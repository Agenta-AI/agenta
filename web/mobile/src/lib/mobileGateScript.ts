import {CLASSIC_MODE_COOKIE, MOBILE_OPTIN_COOKIE, VIEW_PARAM} from "@agenta/shared/utils/mobileGate"

/** Where a document load goes when the reverse gate may act on it; `proxy.ts` answers it. */
export const GATE_PATH = "/__gate"

/**
 * Sends a document load to {@link GATE_PATH} when the gate may act on it: `?view=mobile`, or
 * Classic mode on with no opt-in. The proxy matches only entry routes (see its `matcher`), so
 * client navigations to every other route skip the `_next/data` round trip middleware costs; this
 * runs before paint and covers those routes instead. Framed loads (embeds) are not gated, as before.
 * A second trip within 3 s for the same URL is a loop (the gate let it through) and stays put; the
 * hash rides on the gate URL, since a redirect keeps the fragment of the URL it answers.
 */
export const mobileGateScript = `(function(){try{
if(window.top!==window)return;
var p=location.pathname.replace(/^\\/m(?=\\/|$)/,'')||'/';
if(p==='/'||/^\\/(auth|invite)(\\/|$)/.test(p))return;
var c='; '+document.cookie+'; ';
var view=new URLSearchParams(location.search).get('${VIEW_PARAM}')==='mobile';
var classic=c.indexOf('; ${CLASSIC_MODE_COOKIE}=1; ')>=0&&!/; ${MOBILE_OPTIN_COOKIE}=[^;]/.test(c);
if(!view&&!classic)return;
var to=p+location.search,k='agenta:gate',last=(sessionStorage.getItem(k)||'').split('|');
if(last[0]===to&&Date.now()-Number(last[1])<3e3)return;
sessionStorage.setItem(k,to+'|'+Date.now());
location.replace('/m${GATE_PATH}?to='+encodeURIComponent(to)+location.hash);
}catch(e){}})();`
