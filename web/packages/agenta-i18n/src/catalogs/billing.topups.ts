import en from "../../locales/en/billing.topups.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.topups",
    en,
    (language) => import(`../../locales/${language}/billing.topups.json`),
)
