simple_rag_trace = {
    "version": "2.0",
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
    "version": "2.0",
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


simple_rag_trace_for_baseresponse_v3 = {
    "version": "3.0",
    "data": {},
    "tree": {
        "nodes": [
            {
                "lifecycle": {
                    "created_at": "2024-11-16T19:21:25.839557",
                    "updated_at": None,
                    "updated_by_id": None,
                    "updated_by": None,
                },
                "root": {"id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57"},
                "tree": {"id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57", "type": None},
                "node": {
                    "id": "007a51b2-60cf-eb57-69c0-c57f7e38fec6",
                    "name": "rag",
                    "type": "workflow",
                },
                "parent": None,
                "time": {
                    "start": "2024-11-16T19:21:18.838642",
                    "end": "2024-11-16T19:21:25.735744",
                    "span": 6897102,
                },
                "status": {"code": "UNSET", "message": None},
                "exception": None,
                "data": {
                    "inputs": {
                        "topic": "psychology",
                        "genre": "action, suspense",
                        "count": 6,
                    },
                    "outputs": "Sure! Here is a list of 6 movies about psychology in the genre of action and suspense:\n\n1. Blood River (2009): A psychological thriller exploring the destruction of a young couple's seemingly perfect marriage.\n\n2. Alex Cross (2012): A homicide detective pushed to his moral and physical limits as he tangles with a skilled serial killer who specializes in torture and pain.\n\n3. Repeaters (2010): A gritty mind-bending thriller about three twenty-somethings trapped in an impossible time labyrinth.\n\n4. Blue Steel (1989): A female rookie in the police force engages in a cat and mouse game with a pistol-wielding psychopath obsessed with her.\n\n5. Donovan's Echo (2011): A man re-examines his tragic past, memory, and future after experiencing a series of uncanny déjà vu events.\n\n6. House of Last Things (2013): A mind-bending thriller set in Portland, Oregon, exploring the effects of an unspoken tragedy on a house and its inhabitants.",
                },
                "metrics": {
                    "some-scope": {"count": 6},
                    "acc": {
                        "costs": {"total": 0.0028775},
                        "tokens": {"prompt": 920, "completion": 207, "total": 1127},
                    },
                },
                "meta": {
                    "configuration": {
                        "retriever_prompt": "Movies about {topic} in the genre of {genre}.",
                        "retriever_multiplier": 3,
                        "generator_context_prompt": "Given the following list of suggested movies:\n\n{movies}",
                        "generator_instructions_prompt": "Provide a list of {count} movies about {topic} in the genre of {genre}.",
                        "generator_model": "gpt-3.5-turbo",
                        "generator_temperature": 0.8,
                        "summarizer_context_prompt": "Act as a professional cinema critic.\nBe concise and factual.\nUse one intro sentence, and one sentence per movie.",
                        "summarizer_instructions_prompt": "Summarize the following recommendations about {topic} in the genre of {genre}:\n\n{report}",
                        "summarizer_model": "gpt-4o-mini",
                        "summarizer_temperature": 0.2,
                    },
                    "some-scope": {"topic": "psychology", "genre": "action, suspense"},
                },
                "refs": {
                    "application": {"id": "01933668-782a-7bde-9d9e-5808ec9a9901"},
                    "variant": {"id": "40ce591a246e44bf82809dd9c748f02e"},
                },
                "links": None,
                "otel": {
                    "kind": "SPAN_KIND_SERVER",
                    "attributes": None,
                    "events": [],
                    "links": None,
                },
                "nodes": {
                    "retriever": {
                        "lifecycle": {
                            "created_at": "2024-11-16T19:21:25.839161",
                            "updated_at": None,
                            "updated_by_id": None,
                            "updated_by": None,
                        },
                        "root": {"id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57"},
                        "tree": {
                            "id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57",
                            "type": None,
                        },
                        "node": {
                            "id": "007a51b2-60cf-eb57-1cf9-6860802d9008",
                            "name": "retriever",
                            "type": "task",
                        },
                        "parent": {"id": "007a51b2-60cf-eb57-69c0-c57f7e38fec6"},
                        "time": {
                            "start": "2024-11-16T19:21:18.839026",
                            "end": "2024-11-16T19:21:22.468042",
                            "span": 3629016,
                        },
                        "status": {"code": "UNSET", "message": None},
                        "exception": None,
                        "data": {
                            "internals": {
                                "prompt": "Movies about psychology in the genre of action, suspense."
                            },
                            "outputs": {
                                "movies": [
                                    "Blood River (2009) in ['Horror', 'Thriller', 'Western']: A psychological thriller, which explores the destruction of a young couple's seemingly perfect marriage.",
                                    "Alex Cross (2012) in ['Action', 'Crime', 'Mystery']: A homicide detective is pushed to the brink of his moral and physical limits as he tangles with a ferociously skilled serial killer who specializes in torture and pain.",
                                    "Silver Medallist (2009) in ['Action', 'Adventure', 'Comedy']: An action-adventure story focused on the lives of express deliverymen, traffic cops and lonely beauties.",
                                    "Kill Me Again (1989) in ['Action', 'Crime', 'Drama']: A young detective becomes involved with a beautiful woman on the run from the mob and her psychopath boyfriend.",
                                    "Repeaters (2010) in ['Action', 'Crime', 'Drama']: A gritty mind-bending thriller about three twenty-somethings who find themselves in an impossible time labyrinth, where each day they awaken to the same terrifying day as the preceding one.",
                                    "The Tesseract (2003) in ['Action', 'Crime', 'Drama']: A psychologist, an Englishman, a bellboy and a wounded female assasin have their fates crossed at a sleazy Bangkok hotel.",
                                    "Abduction (2011) in ['Action', 'Mystery', 'Thriller']: A thriller centered on a young man who sets out to uncover the truth about his life after finding his baby photo on a missing persons website.",
                                    "Blue Steel (1989) in ['Action', 'Crime', 'Drama']: A female rookie in the police force engages in a cat and mouse game with a pistol wielding psychopath who becomes obsessed with her.",
                                    "Half Past Dead (2002) in ['Action', 'Crime', 'Thriller']: This movie tells the story of a man who goes undercover in a hi-tech prison to find out information to help prosecute those who killed his wife. While there he stumbles onto a plot involving a death-row inmate and his $200 million stash of gold.",
                                    "Painted Skin (2008) in ['Action', 'Drama', 'Thriller']: An action-thriller centered on a vampire-like woman who eats the skins and hearts of her lovers.",
                                    "Donovan's Echo (2011) in ['Drama', 'Fantasy', 'Mystery']: A series of uncanny dèjè vu events force a man to re-examine his tragic past, memory, instinct, and future.",
                                    "Once a Thief (1991) in ['Action', 'Comedy', 'Crime']: A romantic and action packed story of three best friends, a group of high end art thieves, who come into trouble when a love-triangle forms between them.",
                                    "Arrambam (2013) in ['Action', 'Drama', 'Mystery']: A mysterious man along with a young computer hacker tries to unveil a major government conspiracy which resulted in several bloody deaths.",
                                    "House of Last Things (2013) in ['Fantasy', 'Thriller']: A mind-bending thriller set in Portland, Oregon about an unspoken tragedy and its effects on a house, its temporary caretakers and the owners, a classical music critic and his wife on a recuperative trip to Italy.",
                                    "Traffickers (2012) in ['Action', 'Crime', 'Drama']: A thriller about the passengers with different objectives on board a cruiser headed for China, being chased over and over again and unexpected happening of things.",
                                    "Shattered Image (1998) in ['Crime', 'Drama', 'Fantasy']: Confusing realities surface in this paranoid film dealing with the fragile nature of a young woman (Anne Parillaud) recovering from rape and an apparent attempted suicide. In one reality, ...",
                                    "The 6th Day (2000) in ['Action', 'Mystery', 'Sci-Fi']: Futuristic action about a man who meets a clone of himself and stumbles into a grand conspiracy about clones taking over the world.",
                                    "Angel of Death (2009) in ['Action', 'Crime', 'Thriller']: A career assassin becomes haunted by one of her victims following a near fatal injury to her brain. Becoming a rogue assassin settling the score with her former mob employers, chaos and power struggles ensue.",
                                ]
                            },
                        },
                        "metrics": {
                            "acc": {
                                "costs": {"total": 0.0011},
                                "tokens": {"prompt": 11, "total": 11},
                            }
                        },
                        "meta": None,
                        "refs": {
                            "application": {
                                "id": "01933668-782a-7bde-9d9e-5808ec9a9901"
                            }
                        },
                        "links": None,
                        "otel": {
                            "kind": "SPAN_KIND_INTERNAL",
                            "attributes": None,
                            "events": [],
                            "links": None,
                        },
                        "nodes": None,
                    },
                    "reporter": {
                        "lifecycle": {
                            "created_at": "2024-11-16T19:21:25.839450",
                            "updated_at": None,
                            "updated_by_id": None,
                            "updated_by": None,
                        },
                        "root": {"id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57"},
                        "tree": {
                            "id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57",
                            "type": None,
                        },
                        "node": {
                            "id": "007a51b2-60cf-eb57-a6ea-b15a330bbf84",
                            "name": "reporter",
                            "type": "task",
                        },
                        "parent": {"id": "007a51b2-60cf-eb57-69c0-c57f7e38fec6"},
                        "time": {
                            "start": "2024-11-16T19:21:22.468268",
                            "end": "2024-11-16T19:21:25.735240",
                            "span": 3266972,
                        },
                        "status": {"code": "UNSET", "message": None},
                        "exception": None,
                        "data": {
                            "outputs": {
                                "report": "Sure! Here is a list of 6 movies about psychology in the genre of action and suspense:\n\n1. Blood River (2009): A psychological thriller exploring the destruction of a young couple's seemingly perfect marriage.\n\n2. Alex Cross (2012): A homicide detective pushed to his moral and physical limits as he tangles with a skilled serial killer who specializes in torture and pain.\n\n3. Repeaters (2010): A gritty mind-bending thriller about three twenty-somethings trapped in an impossible time labyrinth.\n\n4. Blue Steel (1989): A female rookie in the police force engages in a cat and mouse game with a pistol-wielding psychopath obsessed with her.\n\n5. Donovan's Echo (2011): A man re-examines his tragic past, memory, and future after experiencing a series of uncanny déjà vu events.\n\n6. House of Last Things (2013): A mind-bending thriller set in Portland, Oregon, exploring the effects of an unspoken tragedy on a house and its inhabitants."
                            }
                        },
                        "metrics": {
                            "acc": {
                                "costs": {"total": 0.0017775},
                                "tokens": {
                                    "prompt": 909,
                                    "completion": 207,
                                    "total": 1116,
                                },
                            }
                        },
                        "meta": None,
                        "refs": {
                            "application": {
                                "id": "01933668-782a-7bde-9d9e-5808ec9a9901"
                            }
                        },
                        "links": None,
                        "otel": {
                            "kind": "SPAN_KIND_INTERNAL",
                            "attributes": None,
                            "events": [],
                            "links": None,
                        },
                        "nodes": {
                            "chat": {
                                "lifecycle": {
                                    "created_at": "2024-11-16T19:21:25.839295",
                                    "updated_at": None,
                                    "updated_by_id": None,
                                    "updated_by": None,
                                },
                                "root": {"id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57"},
                                "tree": {
                                    "id": "7f8d1a05-f4ac-4145-007a-51b260cfeb57",
                                    "type": None,
                                },
                                "node": {
                                    "id": "007a51b2-60cf-eb57-5cbb-1351f06949c7",
                                    "name": "chat",
                                    "type": "completion",
                                },
                                "parent": {
                                    "id": "007a51b2-60cf-eb57-a6ea-b15a330bbf84"
                                },
                                "time": {
                                    "start": "2024-11-16T19:21:22.468632",
                                    "end": "2024-11-16T19:21:25.735134",
                                    "span": 3266502,
                                },
                                "status": {"code": "UNSET", "message": None},
                                "exception": None,
                                "data": {
                                    "inputs": {
                                        "prompts": {
                                            "system": "Given the following list of suggested movies:\n\nBlood River (2009) in ['Horror', 'Thriller', 'Western']: A psychological thriller, which explores the destruction of a young couple's seemingly perfect marriage.\nAlex Cross (2012) in ['Action', 'Crime', 'Mystery']: A homicide detective is pushed to the brink of his moral and physical limits as he tangles with a ferociously skilled serial killer who specializes in torture and pain.\nSilver Medallist (2009) in ['Action', 'Adventure', 'Comedy']: An action-adventure story focused on the lives of express deliverymen, traffic cops and lonely beauties.\nKill Me Again (1989) in ['Action', 'Crime', 'Drama']: A young detective becomes involved with a beautiful woman on the run from the mob and her psychopath boyfriend.\nRepeaters (2010) in ['Action', 'Crime', 'Drama']: A gritty mind-bending thriller about three twenty-somethings who find themselves in an impossible time labyrinth, where each day they awaken to the same terrifying day as the preceding one.\nThe Tesseract (2003) in ['Action', 'Crime', 'Drama']: A psychologist, an Englishman, a bellboy and a wounded female assasin have their fates crossed at a sleazy Bangkok hotel.\nAbduction (2011) in ['Action', 'Mystery', 'Thriller']: A thriller centered on a young man who sets out to uncover the truth about his life after finding his baby photo on a missing persons website.\nBlue Steel (1989) in ['Action', 'Crime', 'Drama']: A female rookie in the police force engages in a cat and mouse game with a pistol wielding psychopath who becomes obsessed with her.\nHalf Past Dead (2002) in ['Action', 'Crime', 'Thriller']: This movie tells the story of a man who goes undercover in a hi-tech prison to find out information to help prosecute those who killed his wife. While there he stumbles onto a plot involving a death-row inmate and his $200 million stash of gold.\nPainted Skin (2008) in ['Action', 'Drama', 'Thriller']: An action-thriller centered on a vampire-like woman who eats the skins and hearts of her lovers.\nDonovan's Echo (2011) in ['Drama', 'Fantasy', 'Mystery']: A series of uncanny dèjè vu events force a man to re-examine his tragic past, memory, instinct, and future.\nOnce a Thief (1991) in ['Action', 'Comedy', 'Crime']: A romantic and action packed story of three best friends, a group of high end art thieves, who come into trouble when a love-triangle forms between them.\nArrambam (2013) in ['Action', 'Drama', 'Mystery']: A mysterious man along with a young computer hacker tries to unveil a major government conspiracy which resulted in several bloody deaths.\nHouse of Last Things (2013) in ['Fantasy', 'Thriller']: A mind-bending thriller set in Portland, Oregon about an unspoken tragedy and its effects on a house, its temporary caretakers and the owners, a classical music critic and his wife on a recuperative trip to Italy.\nTraffickers (2012) in ['Action', 'Crime', 'Drama']: A thriller about the passengers with different objectives on board a cruiser headed for China, being chased over and over again and unexpected happening of things.\nShattered Image (1998) in ['Crime', 'Drama', 'Fantasy']: Confusing realities surface in this paranoid film dealing with the fragile nature of a young woman (Anne Parillaud) recovering from rape and an apparent attempted suicide. In one reality, ...\nThe 6th Day (2000) in ['Action', 'Mystery', 'Sci-Fi']: Futuristic action about a man who meets a clone of himself and stumbles into a grand conspiracy about clones taking over the world.\nAngel of Death (2009) in ['Action', 'Crime', 'Thriller']: A career assassin becomes haunted by one of her victims following a near fatal injury to her brain. Becoming a rogue assassin settling the score with her former mob employers, chaos and power struggles ensue.",
                                            "user": "Provide a list of 6 movies about psychology in the genre of action, suspense.",
                                        },
                                        "opts": {
                                            "model": "gpt-3.5-turbo",
                                            "temperature": 0.8,
                                        },
                                    },
                                    "outputs": "Sure! Here is a list of 6 movies about psychology in the genre of action and suspense:\n\n1. Blood River (2009): A psychological thriller exploring the destruction of a young couple's seemingly perfect marriage.\n\n2. Alex Cross (2012): A homicide detective pushed to his moral and physical limits as he tangles with a skilled serial killer who specializes in torture and pain.\n\n3. Repeaters (2010): A gritty mind-bending thriller about three twenty-somethings trapped in an impossible time labyrinth.\n\n4. Blue Steel (1989): A female rookie in the police force engages in a cat and mouse game with a pistol-wielding psychopath obsessed with her.\n\n5. Donovan's Echo (2011): A man re-examines his tragic past, memory, and future after experiencing a series of uncanny déjà vu events.\n\n6. House of Last Things (2013): A mind-bending thriller set in Portland, Oregon, exploring the effects of an unspoken tragedy on a house and its inhabitants.",
                                },
                                "metrics": {
                                    "unit": {
                                        "costs": {"total": 0.0017775},
                                        "tokens": {
                                            "prompt": 909,
                                            "completion": 207,
                                            "total": 1116,
                                        },
                                    },
                                    "acc": {
                                        "costs": {"total": 0.0017775},
                                        "tokens": {
                                            "prompt": 909,
                                            "completion": 207,
                                            "total": 1116,
                                        },
                                    },
                                },
                                "meta": None,
                                "refs": {
                                    "application": {
                                        "id": "01933668-782a-7bde-9d9e-5808ec9a9901"
                                    }
                                },
                                "links": None,
                                "otel": {
                                    "kind": "SPAN_KIND_CLIENT",
                                    "attributes": None,
                                    "events": [],
                                    "links": None,
                                },
                                "nodes": None,
                            }
                        },
                    },
                },
            }
        ],
        "version": "1.0.0",
        "count": None,
    },
}
