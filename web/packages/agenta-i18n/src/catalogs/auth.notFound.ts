import en from "../../locales/en/auth.notFound.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.notFound",
    en,
    (language) => import(`../../locales/${language}/auth.notFound.json`),
)
