import en from "../../locales/en/auth.productPreview.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.productPreview",
    en,
    (language) => import(`../../locales/${language}/auth.productPreview.json`),
)
