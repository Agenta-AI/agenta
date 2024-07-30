import os
import pytest

from agenta_backend.services.evaluators_service import (
    auto_levenshtein_distance,
    auto_starts_with,
    auto_ends_with,
    auto_contains,
    auto_contains_any,
    auto_contains_all,
    auto_contains_json,
    auto_json_diff,
    auto_semantic_similarity,
    rag_context_relevancy,
    rag_faithfulness,
)


@pytest.mark.parametrize(
    "output, settings_values, expected",
    [
        (
            "Hello world",
            {
                "prefix": "He",
                "case_sensitive": True,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "hello world",
            {
                "prefix": "He",
                "case_sensitive": False,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "Hello world",
            {
                "prefix": "he",
                "case_sensitive": False,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "Hello world",
            {
                "prefix": "world",
                "case_sensitive": True,
                "correct_answer_keys": ["correct_answer"],
            },
            False,
        ),
    ],
)
def test_auto_starts_with(output, settings_values, expected):
    result = auto_starts_with(
        inputs={},
        output=output,
        data_point={},
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


# Test for auto_ends_with


@pytest.mark.parametrize(
    "output, suffix, case_sensitive, expected",
    [
        ("Hello world", "world", True, True),
        ("hello world", "World", False, True),
        ("Hello world", "World", True, False),
        ("Hello world", "Hello", True, False),
    ],
)
def test_auto_ends_with(output, suffix, case_sensitive, expected):
    result = auto_ends_with(
        {},
        output,
        {},
        {},
        {"suffix": suffix, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains


@pytest.mark.parametrize(
    "output, substring, case_sensitive, expected",
    [
        ("Hello world", "lo wo", True, True),
        ("Hello world", "LO WO", False, True),
        ("Hello world", "abc", True, False),
    ],
)
def test_auto_contains(output, substring, case_sensitive, expected):
    result = auto_contains(
        {},
        output,
        {},
        {},
        {"substring": substring, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_any


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, True),
        ("Hello world", "world,universe", True, True),
        ("Hello world", "world,universe", False, True),
        ("Hello world", "abc,xyz", True, False),
    ],
)
def test_auto_contains_any(output, substrings, case_sensitive, expected):
    result = auto_contains_any(
        {},
        output,
        {},
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_all


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, False),
        ("Hello world", "Hello,world", True, True),
        ("Hello world", "hello,world", False, True),
        ("Hello world", "world,universe", True, False),
    ],
)
def test_auto_contains_all(output, substrings, case_sensitive, expected):
    result = auto_contains_all(
        {},
        output,
        {},
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_json
@pytest.mark.parametrize(
    "output, expected",
    [
        ('Some random text {"key": "value"} more text', True),
        ("No JSON here!", False),
        ("{Malformed JSON, nope!}", False),
        ('{"valid": "json", "number": 123}', True),
    ],
)
def test_auto_contains_json(output, expected):
    result = auto_contains_json({}, output, {}, {}, {}, {})
    assert result.value == expected


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_min, expected_max",
    [
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"user": {"name": "John", "details": {"age": "30", "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": True,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"USER": {"NAME": "John", "DETAILS": {"AGE": 30, "LOCATION": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": True,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
    ],
)
def test_auto_json_diff(
    ground_truth, app_output, settings_values, expected_min, expected_max
):
    result = auto_json_diff({}, app_output, ground_truth, {}, settings_values, {})
    assert expected_min <= result.value <= expected_max


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_min, expected_max",
    [
        (
            {"correct_answer": "The capital of Kiribati is Tarawa."},
            "The capital of Kiribati is South Tarawa.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {"correct_answer": "The capital of Tuvalu is Funafuti."},
            "The capital of Tuvalu is Funafuti.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {"correct_answer": "The capital of Kyrgyzstan is Bishkek."},
            "Yaren District.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
    ],
)
def test_auto_semantic_similarity_match(
    ground_truth, app_output, settings_values, expected_min, expected_max
):
    result = auto_semantic_similarity(
        {},
        app_output,
        ground_truth,
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )
    assert expected_min <= round(result.value, 3) <= expected_max


@pytest.mark.parametrize(
    "output, data_point, settings_values, expected",
    [
        (
            "hello world",
            {"correct_answer": "hello world"},
            {"threshold": 5, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hola mundo"},
            {"threshold": 5, "correct_answer_key": "correct_answer"},
            False,
        ),
        (
            "hello world",
            {"correct_answer": "hello world!"},
            {"threshold": 2, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hello wor"},
            {"threshold": 10, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hello worl"},
            {"correct_answer_key": "correct_answer"},
            1,
        ),
        (
            "hello world",
            {"correct_answer": "helo world"},
            {"correct_answer_key": "correct_answer"},
            1,
        ),
    ],
)
def test_auto_levenshtein_distance(output, data_point, settings_values, expected):
    result = auto_levenshtein_distance(
        inputs={},
        output=output,
        data_point=data_point,
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


app_output = {
    "data": {
        "message": "aloha",
    },
    "trace": {
        "trace_id": "66a2862603cbee93a25914ad",
        "cost": None,
        "usage": None,
        "latency": 6.372497,
        "spans": [
            {
                "id": "66a2862603cbee93a25914ac",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {"topic": "witches", "genre": "fiction", "count": 3},
                "locals": None,
                "outputs": {
                    "message": 'Witches in fiction are depicted through a mix of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) delves into the complexities of teenage witchcraft, showcasing both empowerment and the darker repercussions of their actions.  \n"Snow White: A Tale of Terror" (1997) offers a sinister twist on the classic story, highlighting the witch\'s envy and vengeful nature.  \n"Hocus Pocus" (1993) delivers a comedic and adventurous take on witchcraft, as three resurrected witches wreak havoc in contemporary Salem.'
                },
                "config": {},
                "environment": "bash",
                "tags": None,
                "token_consumption": None,
                "name": "rag",
                "parent_span_id": None,
                "attributes": {},
                "spankind": "RAG",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:46.141393Z",
                "end_time": "2024-07-25T17:06:52.513890Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914ae",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {"topic": "witches", "genre": "fiction", "count": 3},
                "locals": {
                    "prompt": "Movies about witches in the genre of fiction.",
                    "topk": 9,
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
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "retriever",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "spankind": "RETRIEVER",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:46.141563Z",
                "end_time": "2024-07-25T17:06:46.885700Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914af",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "description": "Movies about witches in the genre of fiction."
                },
                "locals": None,
                "outputs": {"message": [0, 2, 3, 4, 5, 6, 7, 8, 9]},
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "embed",
                "parent_span_id": "66a2862603cbee93a25914ae",
                "attributes": {},
                "spankind": "EMBEDDING",
                "status": "OK",
                "user": None,
                "start_time": "2024-07-25T17:06:46.141683Z",
                "end_time": "2024-07-25T17:06:46.593858Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914b0",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "db": "Database(MongoClient(host=['ac-t3c3s8s-shard-00-01.qdqqcim.mongodb.net:27017', 'ac-t3c3s8s-shard-00-02.qdqqcim.mongodb.net:27017', 'ac-t3c3s8s-shard-00-00.qdqqcim.mongodb.net:27017'], document_class=dict, tz_aware=False, connect=True, retrywrites=True, w='majority', appname='AgentaCluster', authsource='admin', replicaset='atlas-s2jfsv-shard-0', tls=True, tlscafile='/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/certifi/cacert.pem', server_api=<pymongo.server_api.ServerApi object at 0x1083a37d0>), 'sample_mflix')",
                    "query": [0, 2, 3, 4, 5, 6, 7, 8, 9],
                    "topk": 9,
                },
                "locals": None,
                "outputs": {
                    "message": [
                        {
                            "plot": "A newcomer to a Catholic prep high school falls in with a trio of outcast teenage girls who practice witchcraft and they all soon conjure up various spells and curses against those who even slightly anger them.",
                            "genres": ["Drama", "Fantasy", "Horror"],
                            "title": "The Craft",
                            "year": 1996,
                        },
                        {
                            "plot": "A small-time magician is swept away to an enchanted land and is forced into a power struggle between three witches.",
                            "genres": ["Adventure", "Family", "Fantasy"],
                            "title": "Oz the Great and Powerful",
                            "year": 2013,
                        },
                        {
                            "plot": "In this dark take on the fairy tale, the growing hatred of a noblewoman, secretly a practitioner of the dark arts, for her stepdaughter, and the witch's horrifying attempts to kill her.",
                            "genres": ["Fantasy", "Horror"],
                            "title": "Snow White: A Tale of Terror",
                            "year": 1997,
                        },
                        {
                            "plot": "A witch tasks a childless baker and his wife with procuring magical items from classic fairy tales to reverse the curse put on their family tree.",
                            "genres": ["Adventure", "Fantasy", "Musical"],
                            "title": "Into the Woods",
                            "year": 2014,
                        },
                        {
                            "plot": "A mother/daughter pair of witches descend on a yuppie family's home and cause havoc, one at a time since they share one body & the other must live in a cat the rest of the time. Now it's up...",
                            "genres": ["Comedy", "Fantasy"],
                            "title": "Wicked Stepmother",
                            "year": 1989,
                        },
                        {
                            "plot": "After three centuries, three witch sisters are resurrected in Salem Massachusetts on Halloween night, and it is up to two teen-agers, a young girl, and an immortal cat to put an end to the witches' reign of terror once and for all.",
                            "genres": ["Comedy", "Family", "Fantasy"],
                            "title": "Hocus Pocus",
                            "year": 1993,
                        },
                        {
                            "plot": "A warlock flees from the 17th to the 20th century, with a witch-hunter in hot pursuit.",
                            "genres": ["Action", "Fantasy", "Horror"],
                            "title": "Warlock",
                            "year": 1989,
                        },
                        {
                            "plot": 'The adventures of Geralt of Rivea, "The Witcher".',
                            "genres": ["Adventure", "Fantasy"],
                            "title": "The Hexer",
                            "year": 2001,
                        },
                        {
                            "plot": "A glowing orb terrorizes a young girl with a collection of stories of dark fantasy, eroticism and horror.",
                            "genres": ["Animation", "Adventure", "Fantasy"],
                            "title": "Heavy Metal",
                            "year": 1981,
                        },
                    ]
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "search",
                "parent_span_id": "66a2862603cbee93a25914ae",
                "attributes": {},
                "spankind": "SEARCH",
                "status": "OK",
                "user": None,
                "start_time": "2024-07-25T17:06:46.594219Z",
                "end_time": "2024-07-25T17:06:46.885542Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914b1",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "topic": "witches",
                    "genre": "fiction",
                    "count": 3,
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
                    ],
                },
                "locals": None,
                "outputs": {
                    "report": "1. The Craft (1996)\n2. Snow White: A Tale of Terror (1997)\n3. Hocus Pocus (1993)"
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "reporter",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "spankind": "GENERATOR",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:46.885880Z",
                "end_time": "2024-07-25T17:06:48.008789Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862603cbee93a25914b2",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "prompts": {
                        "system": "Given the following list of suggested movies:\nThe Craft (1996) in ['Drama', 'Fantasy', 'Horror']: A newcomer to a Catholic prep high school falls in with a trio of outcast teenage girls who practice witchcraft and they all soon conjure up various spells and curses against those who even slightly anger them.\nOz the Great and Powerful (2013) in ['Adventure', 'Family', 'Fantasy']: A small-time magician is swept away to an enchanted land and is forced into a power struggle between three witches.\nSnow White: A Tale of Terror (1997) in ['Fantasy', 'Horror']: In this dark take on the fairy tale, the growing hatred of a noblewoman, secretly a practitioner of the dark arts, for her stepdaughter, and the witch's horrifying attempts to kill her.\nInto the Woods (2014) in ['Adventure', 'Fantasy', 'Musical']: A witch tasks a childless baker and his wife with procuring magical items from classic fairy tales to reverse the curse put on their family tree.\nWicked Stepmother (1989) in ['Comedy', 'Fantasy']: A mother/daughter pair of witches descend on a yuppie family's home and cause havoc, one at a time since they share one body & the other must live in a cat the rest of the time. Now it's up...\nHocus Pocus (1993) in ['Comedy', 'Family', 'Fantasy']: After three centuries, three witch sisters are resurrected in Salem Massachusetts on Halloween night, and it is up to two teen-agers, a young girl, and an immortal cat to put an end to the witches' reign of terror once and for all.\nWarlock (1989) in ['Action', 'Fantasy', 'Horror']: A warlock flees from the 17th to the 20th century, with a witch-hunter in hot pursuit.\nThe Hexer (2001) in ['Adventure', 'Fantasy']: The adventures of Geralt of Rivea, \"The Witcher\".\nHeavy Metal (1981) in ['Animation', 'Adventure', 'Fantasy']: A glowing orb terrorizes a young girl with a collection of stories of dark fantasy, eroticism and horror.\n",
                        "user": "Provide a list of 3 movies about witches in the genre of fiction.",
                    },
                    "opts": {"model": "gpt-3.5-turbo", "temperature": 0.8},
                },
                "locals": None,
                "outputs": {
                    "message": "1. The Craft (1996)\n2. Snow White: A Tale of Terror (1997)\n3. Hocus Pocus (1993)"
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "chat",
                "parent_span_id": "66a2862603cbee93a25914b1",
                "attributes": {},
                "spankind": "MESSAGE",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:46.886069Z",
                "end_time": "2024-07-25T17:06:48.008701Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862803cbee93a25914b3",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "topic": "witches",
                    "genre": "fiction",
                    "report": "1. The Craft (1996)\n2. Snow White: A Tale of Terror (1997)\n3. Hocus Pocus (1993)",
                },
                "locals": None,
                "outputs": {
                    "report": 'The portrayal of witches in fiction often blends elements of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) explores the lives of teenage girls who dabble in witchcraft, leading to both empowerment and tragic consequences.  \n"Snow White: A Tale of Terror" (1997) presents a dark reimagining of the classic fairy tale, emphasizing the malevolent nature of the witch as a figure of envy and vengeance.  \n"Hocus Pocus" (1993) combines humor and family-friendly adventure, featuring three resurrected witches who create chaos in modern-day Salem.'
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "summarizer",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "spankind": "GENERATOR",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:48.008960Z",
                "end_time": "2024-07-25T17:06:50.075531Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862803cbee93a25914b4",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "prompts": {
                        "system": "Act as a professional cinema critic.\nBe concise and factual.\nUse one intro sentence, and one sentence per movie.",
                        "user": "Summarize the following recommendations about witches in the genre of fiction:\n\n1. The Craft (1996)\n2. Snow White: A Tale of Terror (1997)\n3. Hocus Pocus (1993)",
                    },
                    "opts": {"model": "gpt-4o-mini", "temperature": 0.2},
                },
                "locals": None,
                "outputs": {
                    "message": 'The portrayal of witches in fiction often blends elements of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) explores the lives of teenage girls who dabble in witchcraft, leading to both empowerment and tragic consequences.  \n"Snow White: A Tale of Terror" (1997) presents a dark reimagining of the classic fairy tale, emphasizing the malevolent nature of the witch as a figure of envy and vengeance.  \n"Hocus Pocus" (1993) combines humor and family-friendly adventure, featuring three resurrected witches who create chaos in modern-day Salem.'
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "chat",
                "parent_span_id": "66a2862803cbee93a25914b3",
                "attributes": {},
                "spankind": "MESSAGE",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:48.009321Z",
                "end_time": "2024-07-25T17:06:50.075418Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862a03cbee93a25914b5",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "topic": "witches",
                    "genre": "fiction",
                    "report": 'The portrayal of witches in fiction often blends elements of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) explores the lives of teenage girls who dabble in witchcraft, leading to both empowerment and tragic consequences.  \n"Snow White: A Tale of Terror" (1997) presents a dark reimagining of the classic fairy tale, emphasizing the malevolent nature of the witch as a figure of envy and vengeance.  \n"Hocus Pocus" (1993) combines humor and family-friendly adventure, featuring three resurrected witches who create chaos in modern-day Salem.',
                },
                "locals": None,
                "outputs": {
                    "report": 'Witches in fiction are depicted through a mix of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) delves into the complexities of teenage witchcraft, showcasing both empowerment and the darker repercussions of their actions.  \n"Snow White: A Tale of Terror" (1997) offers a sinister twist on the classic story, highlighting the witch\'s envy and vengeful nature.  \n"Hocus Pocus" (1993) delivers a comedic and adventurous take on witchcraft, as three resurrected witches wreak havoc in contemporary Salem.'
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "summarizer",
                "parent_span_id": "66a2862603cbee93a25914ac",
                "attributes": {},
                "spankind": "GENERATOR",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:50.075792Z",
                "end_time": "2024-07-25T17:06:52.513867Z",
                "tokens": None,
                "cost": None,
            },
            {
                "id": "66a2862a03cbee93a25914b6",
                "app_id": "0190e436-818a-7c97-83b4-d7af4bd23e99",
                "inputs": {
                    "prompts": {
                        "system": "Act as a professional cinema critic.\nBe concise and factual.\nUse one intro sentence, and one sentence per movie.",
                        "user": 'Summarize the following recommendations about witches in the genre of fiction:\n\nThe portrayal of witches in fiction often blends elements of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) explores the lives of teenage girls who dabble in witchcraft, leading to both empowerment and tragic consequences.  \n"Snow White: A Tale of Terror" (1997) presents a dark reimagining of the classic fairy tale, emphasizing the malevolent nature of the witch as a figure of envy and vengeance.  \n"Hocus Pocus" (1993) combines humor and family-friendly adventure, featuring three resurrected witches who create chaos in modern-day Salem.',
                    },
                    "opts": {"model": "gpt-4o-mini", "temperature": 0.2},
                },
                "locals": None,
                "outputs": {
                    "message": 'Witches in fiction are depicted through a mix of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) delves into the complexities of teenage witchcraft, showcasing both empowerment and the darker repercussions of their actions.  \n"Snow White: A Tale of Terror" (1997) offers a sinister twist on the classic story, highlighting the witch\'s envy and vengeful nature.  \n"Hocus Pocus" (1993) delivers a comedic and adventurous take on witchcraft, as three resurrected witches wreak havoc in contemporary Salem.'
                },
                "config": None,
                "tags": None,
                "token_consumption": None,
                "name": "chat",
                "parent_span_id": "66a2862a03cbee93a25914b5",
                "attributes": {},
                "spankind": "MESSAGE",
                "status": "UNSET",
                "user": None,
                "start_time": "2024-07-25T17:06:50.076096Z",
                "end_time": "2024-07-25T17:06:52.513824Z",
                "tokens": None,
                "cost": None,
            },
        ],
    },
}


@pytest.mark.parametrize(
    "settings_values, expected_min, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.locals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            0.0,
            1.0,
        ),
        # add more use cases
    ],
)
def test_rag_faithfulness_evaluator(settings_values, expected_min, expected_max):
    result = rag_faithfulness(
        {},
        app_output,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )

    assert expected_min <= round(result.value, 1) <= expected_max


@pytest.mark.parametrize(
    "settings_values, expected_min, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.locals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            0.0,
            1.0,
        ),
        # add more use cases
    ],
)
def test_rag_context_relevancy_evaluator(settings_values, expected_min, expected_max):
    result = rag_context_relevancy(
        {},
        app_output,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError as error:
        # exceptions
        # - raised by autoevals -> ValueError (caught already and then passed as a stacktrace to the result)
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)
        assert result.error.message == "Error during RAG Context Relevancy evaluation"
