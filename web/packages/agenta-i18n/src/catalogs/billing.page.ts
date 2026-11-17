import en from "../../locales/en/billing.page.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.page",
    en,
    (language) => import(`../../locales/${language}/billing.page.json`),
)
