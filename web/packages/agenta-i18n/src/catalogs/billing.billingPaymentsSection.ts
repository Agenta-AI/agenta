import en from "../../locales/en/billing.billingPaymentsSection.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.billingPaymentsSection",
    en,
    (language) => import(`../../locales/${language}/billing.billingPaymentsSection.json`),
)
