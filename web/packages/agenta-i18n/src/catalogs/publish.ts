import en from "../../locales/en/publish.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "publish",
    en,
    (language) => import(`../../locales/${language}/publish.json`),
)
