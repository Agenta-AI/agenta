import en from "../../locales/en/auth.shared.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.shared",
    en,
    (language) => import(`../../locales/${language}/auth.shared.json`),
)
