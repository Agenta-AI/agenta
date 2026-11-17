import en from "../../locales/en/settingsTabs.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settingsTabs",
    en,
    (language) => import(`../../locales/${language}/settingsTabs.json`),
)
