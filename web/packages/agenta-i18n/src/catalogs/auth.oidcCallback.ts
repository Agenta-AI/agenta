import en from "../../locales/en/auth.oidcCallback.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.oidcCallback",
    en,
    (language) => import(`../../locales/${language}/auth.oidcCallback.json`),
)
