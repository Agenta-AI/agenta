import en from "../../locales/en/billing.planChooserSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "billing.planChooserSheet",
    en,
    (language) => import(`../../locales/${language}/billing.planChooserSheet.json`),
)
