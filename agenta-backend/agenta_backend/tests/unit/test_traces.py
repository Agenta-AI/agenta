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
