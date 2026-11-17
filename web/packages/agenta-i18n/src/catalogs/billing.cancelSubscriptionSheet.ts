import en from "../../locales/en/billing.cancelSubscriptionSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.cancelSubscriptionSheet",
    en,
    (language) => import(`../../locales/${language}/billing.cancelSubscriptionSheet.json`),
)
