simple_rag_trace = {
    "data": {},
    "trace": {
        "trace_id": "66a2862603cbee93a25914ad",
        "cost": None,
        "usage": None,
        "latency": 6.372497,
        "spans": [
            {
                "id": "66a2862603cbee93a25914ac",
                "inputs": {},
                "internals": {},
                "outputs": {},
                "token_consumption": None,
                "name": "rag",
                "parent_span_id": None,
                "attributes": {},
                "start_time": "2024-07-25T17:06:46.141393Z",
                "end_time": "2024-07-25T17:06:52.513890Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914ae",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {},
                "internals": {
                    "prompt": "Movies about witches in the genre of fiction."
                },
                "outputs": {
                    "movies": [
                        "The Craft (1996) in ['Drama', 'Fantasy', 'Horror']: A newcomer to a Catholic prep high school falls in with a trio of outcast teenage girls who practice witchcraft and they all soon conjure up various spells and curses against those who even slightly anger them.",
                        "Oz the Great and Powerful (2013) in ['Adventure', 'Family', 'Fantasy']: A small-time magician is swept away to an enchanted land and is forced into a power struggle between three witches.",
                        "Snow White: A Tale of Terror (1997) in ['Fantasy', 'Horror']: In this dark take on the fairy tale, the growing hatred of a noblewoman, secretly a practitioner of the dark arts, for her stepdaughter, and the witch's horrifying attempts to kill her.",
                        "Into the Woods (2014) in ['Adventure', 'Fantasy', 'Musical']: A witch tasks a childless baker and his wife with procuring magical items from classic fairy tales to reverse the curse put on their family tree.",
                        "Wicked Stepmother (1989) in ['Comedy', 'Fantasy']: A mother/daughter pair of witches descend on a yuppie family's home and cause havoc, one at a time since they share one body & the other must live in a cat the rest of the time. Now it's up...",
                        "Hocus Pocus (1993) in ['Comedy', 'Family', 'Fantasy']: After three centuries, three witch sisters are resurrected in Salem Massachusetts on Halloween night, and it is up to two teen-agers, a young girl, and an immortal cat to put an end to the witches' reign of terror once and for all.",
                        "Warlock (1989) in ['Action', 'Fantasy', 'Horror']: A warlock flees from the 17th to the 20th century, with a witch-hunter in hot pursuit.",
                        "The Hexer (2001) in ['Adventure', 'Fantasy']: The adventures of Geralt of Rivea, \"The Witcher\".",
                        "Heavy Metal (1981) in ['Animation', 'Adventure', 'Fantasy']: A glowing orb terrorizes a young girl with a collection of stories of dark fantasy, eroticism and horror.",
                    ]
                },
                "token_consumption": None,
                "name": "retriever",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "start_time": "2024-07-25T17:06:46.141563Z",
                "end_time": "2024-07-25T17:06:46.885700Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914b1",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {},
                "internals": {},
                "outputs": {
                    "report": 'Witches in fiction are depicted through a mix of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) delves into the complexities of teenage witchcraft, showcasing both empowerment and the darker repercussions of their actions.  \n"Snow White: A Tale of Terror" (1997) offers a sinister twist on the classic story, highlighting the witch\'s envy and vengeful nature.  \n"Hocus Pocus" (1993) delivers a comedic and adventurous take on witchcraft, as three resurrected witches wreak havoc in contemporary Salem.'
                },
                "token_consumption": None,
                "name": "reporter",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "start_time": "2024-07-25T17:06:46.885880Z",
                "end_time": "2024-07-25T17:06:48.008789Z",
                "tokens": None,
                "cost": None,
            },
        ],
    },
}


simple_finance_assisstant_trace = {
    "data": {},
    "trace": {
        "trace_id": "66a61777a1e481ab498bc7b5",
        "cost": None,
        "usage": None,
        "latency": 12.372497,
        "spans": [
            {
                "id": "66a61777a1e481ab498bc7b4",
                "name": "diversify",
                "parent_span_id": None,
                "start_time": "2024-07-25T17:06:46.141563Z",
                "end_time": "2024-07-25T17:06:46.885700Z",
                "spankind": "WORKFLOW",
                "metadata": {"cost": None, "latency": 2.641, "usage": None},
                "user_id": "—",
                "inputs": {
                    "currency": "USD",
                    "amount": 800000,
                    "stocks": [],
                    "real_estate_properties": "Konga KFI, Almord City, Cambridge Lounge",
                    "percentage_returns": "6%, 9%, 15%",
                    "durations": "6 months, 9 months, 15 months",
                },
                "internals": None,
                "outputs": {
                    "report": [
                        "**Investment Amount:**\nUSD 800,000\n\n**Real Estate Properties:**\n1. Konga KFI: 6% return, 6 months duration\n2. Almord City: 9% return, 9 months duration\n3. Cambridge Lounge: 15% return, 15 months duration\n\n**Allocation Strategy:**\nTo optimize the investment by balancing risk and return potential, I will allocate a higher percentage to properties with higher returns and longer durations while still maintaining diversification.\n\n**Allocation Breakdown:**\n1. Konga KFI: 30%\n2. Almord City: 30%\n3. Cambridge Lounge: 40%\n\n**Final Allocation:**\n1. Konga KFI: USD 240,000\n2. Almord City: USD 240,000\n3. Cambridge Lounge: USD 320,000"
                    ]
                },
                "config": {
                    "temperature": 0.7,
                    "prompt_system": "You are a financial advisor that helps users allocate their investments. Users will provide an amount of money they wish to invest along with details about stocks and real estate properties. Your goal is to diversify this amount effectively.\n\nUser Inputs: Investment Amount: The total amount the user wants to invest.\nStocks: A list of stocks the user is interested in.\nReal Estate Properties: A list of properties, including their expected returns and investment durations.",
                    "prompt_user": "\nMy currency is {currency}. The total amount I want to invest is {amount}.\n",
                    "max_tokens": 2000,
                    "model": "gpt-4o",
                    "top_p": 1.0,
                    "invest_in_stocks": 0,
                    "invest_in_realestate": 1,
                    "frequence_penalty": 0.0,
                    "presence_penalty": 0.0,
                },
            },
            {
                "id": "66a61777a1e481ab498bc7b6",
                "name": "reporter",
                "parent_span_id": "66a61777a1e481ab498bc7b4",
                "start_time": "2024-07-25T17:06:46.141563Z",
                "end_time": "2024-07-25T17:06:46.885700Z",
                "spankind": "LLM",
                "metadata": {"cost": None, "latency": 2.64, "usage": None},
                "user_id": "—",
                "inputs": {
                    "user_prompt": "\nMy currency is USD. The total amount I want to invest is 800000.\n\nThe user wants to invest in the following stocks: [].\n\nThe user wants to invest in the following real estate properties: Konga KFI, Almord City, Cambridge Lounge. The percentage returns for these properties are 6%, 9%, 15%, and the investment durations are 6 months, 9 months, 15 months.\n"
                },
                "internals": None,
                "outputs": {
                    "report": [
                        "**Investment Amount:**\nUSD 800,000\n\n**Real Estate Properties:**\n1. Konga KFI: 6% return, 6 months duration\n2. Almord City: 9% return, 9 months duration\n3. Cambridge Lounge: 15% return, 15 months duration\n\n**Allocation Strategy:**\nTo optimize the investment by balancing risk and return potential, I will allocate a higher percentage to properties with higher returns and longer durations while still maintaining diversification.\n\n**Allocation Breakdown:**\n1. Konga KFI: 30%\n2. Almord City: 30%\n3. Cambridge Lounge: 40%\n\n**Final Allocation:**\n1. Konga KFI: USD 240,000\n2. Almord City: USD 240,000\n3. Cambridge Lounge: USD 320,000"
                    ]
                },
            },
        ],
    },
}
