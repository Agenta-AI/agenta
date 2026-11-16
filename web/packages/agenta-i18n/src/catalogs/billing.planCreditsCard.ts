import en from "../../locales/en/billing.planCreditsCard.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.planCreditsCard",
    en,
    (language) => import(`../../locales/${language}/billing.planCreditsCard.json`),
)
