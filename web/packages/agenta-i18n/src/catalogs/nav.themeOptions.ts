import en from "../../locales/en/nav.themeOptions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "nav.themeOptions",
    en,
    (language) => import(`../../locales/${language}/nav.themeOptions.json`),
)
