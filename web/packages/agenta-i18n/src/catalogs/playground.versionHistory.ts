import en from "../../locales/en/playground.versionHistory.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.versionHistory",
    en,
    (language) => import(`../../locales/${language}/playground.versionHistory.json`),
)
