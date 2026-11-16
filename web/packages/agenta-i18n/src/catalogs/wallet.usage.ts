import en from "../../locales/en/wallet.usage.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "wallet.usage",
    en,
    (language) => import(`../../locales/${language}/wallet.usage.json`),
)
