import {HTML_LANG, LANGUAGE_COOKIE, LANGUAGE_PENDING_ATTRIBUTE} from "./language"

/**
 * Inline `<head>` script for a statically rendered document: sets `<html lang>` from the
 * cookie before paint and hides the page until the catalog loads, so no English flashes.
 * Its own entry, so the app's client bundle does not carry these strings.
 */
export const languageInitScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${LANGUAGE_COOKIE}=([^;]*)/);var l=m&&decodeURIComponent(m[1]);var L=${JSON.stringify(HTML_LANG)};if(l&&l!=='en'&&Object.prototype.hasOwnProperty.call(L,l)){var h=document.documentElement;h.lang=L[l];h.setAttribute('${LANGUAGE_PENDING_ATTRIBUTE}','');setTimeout(function(){h.removeAttribute('${LANGUAGE_PENDING_ATTRIBUTE}')},3000)}}catch(e){}})();`

/** Style that pairs with {@link languageInitScript}. */
export const languagePendingStyle = `html[${LANGUAGE_PENDING_ATTRIBUTE}] body{visibility:hidden}`
