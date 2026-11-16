import en from "../../locales/en/auth.sideBanner.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.sideBanner",
    en,
    (language) => import(`../../locales/${language}/auth.sideBanner.json`),
)
