import {useEffect} from "react"

import type {EmbedAppearance} from "./embedConfig"

/** The embed's own theme, not the Agenta user's saved one, which the document script applied. */
export const useEmbedTheme = (theme: EmbedAppearance["theme"]) => {
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)")
        const apply = () => {
            const dark = theme === "dark" || (theme === "system" && media.matches)
            document.documentElement.classList.toggle("dark", dark)
            document.documentElement.style.colorScheme = dark ? "dark" : "light"
        }
        apply()
        media.addEventListener("change", apply)
        return () => media.removeEventListener("change", apply)
    }, [theme])
}
