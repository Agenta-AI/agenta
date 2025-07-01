from typing import Callable
from asyncio import sleep

from pydantic import BaseModel

import agenta as ag


class MockMessageModel(BaseModel):
    content: str


class MockChoiceModel(BaseModel):
    message: MockMessageModel


class MockResponseModel(BaseModel):
    choices: list[MockChoiceModel]


@ag.instrument()
def hello_mock_response(*args, **kwargs) -> MockResponseModel:
    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="world",
                )
            )
        ],
    )


@ag.instrument()
def chat_mock_response(*args, **kwargs) -> MockResponseModel:
    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="world",
                    role="assistant",
                )
            )
        ],
    )


@ag.instrument()
def delay_mock_response(*args, **kwargs) -> MockResponseModel:
    sleep(2)

    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="delay",
                )
            )
        ],
    )


@ag.instrument()
def capital_mock_response(*args, **kwargs) -> MockResponseModel:
    country = kwargs.get("messages", [{}, {}])[1].get(
        "content", "What is the capital of _____?"
    )[len("What is the capital of ") :][:-1]

    capital = CAPITALS.get(country, "Unknown")
    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content=f"The capital of {country} is {capital}.",
                )
            )
        ],
    )


MOCKS: dict[str, Callable[..., MockResponseModel]] = {
    "hello": hello_mock_response,
    "chat": chat_mock_response,
    "delay": delay_mock_response,
    "capital": capital_mock_response,
}

CAPITALS = {
    "Afghanistan": "Kabul",
    "Albania": "Tirana",
    "Algeria": "Algiers",
    "Andorra": "Andorra la Vella",
    "Angola": "Luanda",
    "Antigua and Barbuda": "St. John's",
    "Argentina": "Buenos Aires",
    "Armenia": "Yerevan",
    "Australia": "Canberra",
    "Austria": "Vienna",
    "Azerbaijan": "Baku",
    "Bahamas": "Nassau",
    "Bahrain": "Manama",
    "Bangladesh": "Dhaka",
    "Barbados": "Bridgetown",
    "Belarus": "Minsk",
    "Belgium": "Brussels",
    "Belize": "Belmopan",
    "Benin": "Porto-Novo",
    "Bhutan": "Thimphu",
    "Bolivia": "Sucre",
    "Bosnia and Herzegovina": "Sarajevo",
    "Botswana": "Gaborone",
    "Brazil": "Bras\u00edlia",
    "Brunei": "Bandar Seri Begawan",
    "Bulgaria": "Sofia",
    "Burkina Faso": "Ouagadougou",
    "Burundi": "Gitega",
    "Cabo Verde": "Praia",
    "Cambodia": "Phnom Penh",
    "Cameroon": "Yaound\u00e9",
    "Canada": "Ottawa",
    "Central African Republic": "Bangui",
    "Chad": "N'Djamena",
    "Chile": "Santiago",
    "China": "Beijing",
    "Colombia": "Bogot\u00e1",
    "Comoros": "Moroni",
    "Congo (Brazzaville)": "Brazzaville",
    "Congo (Kinshasa)": "Kinshasa",
    "Costa Rica": "San Jos\u00e9",
    "Croatia": "Zagreb",
    "Cuba": "Havana",
    "Cyprus": "Nicosia",
    "Czech Republic": "Prague",
    "Denmark": "Copenhagen",
    "Djibouti": "Djibouti",
    "Dominica": "Roseau",
    "Dominican Republic": "Santo Domingo",
    "East Timor": "Dili",
    "Ecuador": "Quito",
    "Egypt": "Cairo",
    "El Salvador": "San Salvador",
    "Equatorial Guinea": "Malabo",
    "Eritrea": "Asmara",
    "Estonia": "Tallinn",
    "Eswatini": "Mbabane",
    "Ethiopia": "Addis Ababa",
    "Fiji": "Suva",
    "Finland": "Helsinki",
    "France": "Paris",
    "Gabon": "Libreville",
    "Gambia": "Banjul",
    "Georgia": "Tbilisi",
    "Germany": "Berlin",
    "Ghana": "Accra",
    "Greece": "Athens",
    "Grenada": "St. George's",
    "Guatemala": "Guatemala City",
    "Guinea": "Conakry",
    "Guinea-Bissau": "Bissau",
    "Guyana": "Georgetown",
    "Haiti": "Port-au-Prince",
    "Honduras": "Tegucigalpa",
    "Hungary": "Budapest",
    "Iceland": "Reykjavik",
    "India": "New Delhi",
    "Indonesia": "Jakarta",
    "Iran": "Tehran",
    "Iraq": "Baghdad",
    "Ireland": "Dublin",
    "Israel": "Jerusalem",
    "Italy": "Rome",
    "Ivory Coast": "Yamoussoukro",
    "Jamaica": "Kingston",
    "Japan": "Tokyo",
    "Jordan": "Amman",
    "Kazakhstan": "Astana",
    "Kenya": "Nairobi",
    "Kiribati": "South Tarawa",
    "North Korea": "Pyongyang",
    "South Korea": "Seoul",
    "Kosovo": "Pristina",
    "Kuwait": "Kuwait City",
    "Kyrgyzstan": "Bishkek",
    "Laos": "Vientiane",
    "Latvia": "Riga",
    "Lebanon": "Beirut",
    "Lesotho": "Maseru",
    "Liberia": "Monrovia",
    "Libya": "Tripoli",
    "Liechtenstein": "Vaduz",
    "Lithuania": "Vilnius",
    "Luxembourg": "Luxembourg",
    "Madagascar": "Antananarivo",
    "Malawi": "Lilongwe",
    "Malaysia": "Kuala Lumpur",
    "Maldives": "Mal\u00e9",
    "Mali": "Bamako",
    "Malta": "Valletta",
    "Marshall Islands": "Majuro",
    "Mauritania": "Nouakchott",
    "Mauritius": "Port Louis",
    "Mexico": "Mexico City",
    "Micronesia": "Palikir",
    "Moldova": "Chi\u0219in\u0103u",
    "Monaco": "Monaco",
}
