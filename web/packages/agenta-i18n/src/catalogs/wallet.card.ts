import en from "../../locales/en/wallet.card.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "wallet.card",
    en,
    (language) => import(`../../locales/${language}/wallet.card.json`),
)
