import en from "../../locales/en/billing.billingTab.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.billingTab",
    en,
    (language) => import(`../../locales/${language}/billing.billingTab.json`),
)
