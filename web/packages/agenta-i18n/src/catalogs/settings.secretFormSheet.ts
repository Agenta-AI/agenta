import en from "../../locales/en/settings.secretFormSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.secretFormSheet",
    en,
    (language) => import(`../../locales/${language}/settings.secretFormSheet.json`),
)
