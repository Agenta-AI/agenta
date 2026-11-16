import en from "../../locales/en/wallet.history.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "wallet.history",
    en,
    (language) => import(`../../locales/${language}/wallet.history.json`),
)
