import pytest
from datetime import datetime, timezone

from sqlalchemy.future import select

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.models.db_models import (
    ProjectDB,
    UserDB,
)
from oss.src.tests.unit.test_traces import (
    simple_rag_trace,
    simple_finance_assisstant_trace,
)
from oss.src.resources.evaluators.evaluators import get_all_evaluators

from oss.src.dbs.postgres.shared.engine import engine

log = get_module_logger(__name__)

# Set global variables
OPEN_AI_KEY = env.llm.openai
BACKEND_API_HOST = env.agenta.api_url


@pytest.fixture()
async def get_first_user_object():
    """Get the user object from the database or create a new one if not found."""

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        if user is None:
            create_user = UserDB(uid="0")
            session.add(create_user)
            await session.commit()
            await session.refresh(create_user)
            return create_user
        return user


@pytest.fixture()
async def get_second_user_object():
    """Create a second user object."""

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="1"))
        user = result.scalars().first()
        if user is None:
            create_user = UserDB(
                uid="1", username="test_user1", email="test_user1@email.com"
            )
            session.add(create_user)
            await session.commit()
            await session.refresh(create_user)
            return create_user
        return user


@pytest.fixture()
async def get_or_create_project_from_db():
    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB).filter_by(project_name="Default", is_default=True)
        )
        project = result.scalars().first()
        if project is None:
            create_project = ProjectDB(project_name="Default", is_default=True)
            session.add(create_project)
            await session.commit()
            await session.refresh(create_project)
            return create_project
        return project


@pytest.fixture(scope="session")
async def fetch_user():
    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        return user


@pytest.fixture()
def app_variant_create_data():
    return {
        "variant_name": "v1",
        "parameters": {},
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


@pytest.fixture(scope="session")
def use_open_ai_key():
    return OPEN_AI_KEY


@pytest.fixture()
def update_app_variant_parameters():
    return {
        "temperature": 1,
        "model": "gpt-3.5-turbo",
        "max_tokens": -1,
        "prompt_system": "You are an expert in geography.",
        "prompt_user": "What is the capital of {country}?",
        "top_p": 1,
        "frequence_penalty": 0,
        "presence_penalty": 0,
    }


@pytest.fixture()
def app_variant_parameters_updated():
    return {
        "parameters": {
            "temperature": 1.43,
            "model": "gpt-3.5-turbo",
            "max_tokens": 1182,
            "prompt_system": "You are an expert in geography. Answer in Japanese.",
            "prompt_user": "What is the capital of {country}?",
            "top_p": 1,
            "frequence_penalty": 1.4,
            "presence_penalty": 1.25,
            "force_json": 0,
        }
    }


@pytest.fixture()
def evaluators_requiring_llm_keys():
    evaluators_requiring_llm_keys = [
        evaluator["key"]
        for evaluator in get_all_evaluators()
        if evaluator.get("requires_llm_api_keys", False)
        or (
            evaluator.get("settings_template", {})
            .get("requires_llm_api_keys", {})
            .get("default", False)
        )
    ]
    return evaluators_requiring_llm_keys


@pytest.fixture()
def auto_exact_match_evaluator_config():
    return {
        "app_id": "string",
        "name": "ExactMatchEvaluator",
        "evaluator_key": "auto_exact_match",
        "settings_values": {},
    }


@pytest.fixture()
def auto_similarity_match_evaluator_config():
    return {
        "app_id": "string",
        "name": "SimilarityMatchEvaluator",
        "evaluator_key": "auto_similarity_match",
        "settings_values": {"similarity_threshold": 0.3},
    }


@pytest.fixture()
def auto_regex_test_evaluator_config():
    return {
        "app_id": "string",
        "name": "RegexEvaluator",
        "evaluator_key": "auto_regex_test",
        "settings_values": {
            "regex_pattern": "^value\\d{3}$",
            "regex_should_match": False,
        },
    }


@pytest.fixture()
def auto_webhook_test_evaluator_config():
    return {
        "app_id": "string",
        "name": "WebhookEvaluator",
        "evaluator_key": "auto_webhook_test",
        "settings_values": {
            "webhook_url": f"{BACKEND_API_HOST}/evaluations/webhook_example_fake/",
            "webhook_body": {},
        },
    }


@pytest.fixture()
def auto_ai_critique_evaluator_config():
    return {
        "app_id": "string",
        "name": "AICritique_Evaluator",
        "evaluator_key": "auto_ai_critique",
        "settings_values": {
            "open_ai_key": OPEN_AI_KEY,
            "temperature": 0.9,
            "prompt_template": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below: Evaluation strategy: 0 to 10 0 is very bad and 10 is very good. Prompt: {llm_app_prompt_template} Inputs: country: {country} Correct Answer:{correct_answer} Evaluate this: {variant_output} Answer ONLY with one of the given grading or evaluation options.",
        },
    }


@pytest.fixture()
def deploy_to_environment_payload():
    return {"environment_name": "string", "variant_id": "string"}


@pytest.fixture()
def rag_experiment_data_tree():
    return simple_rag_trace


@pytest.fixture()
def simple_experiment_data_tree():
    return simple_finance_assisstant_trace


@pytest.fixture()
def mapper_to_run_auto_exact_match_evaluation():
    return {
        "prediction": "diversify.reporter.outputs.report[0]",
    }


@pytest.fixture()
def mapper_to_run_rag_faithfulness_evaluation():
    return {
        "question": "rag.retriever.internals.prompt",
        "contexts": "rag.retriever.outputs.movies",
        "answer": "rag.reporter.outputs.report",
    }


@pytest.fixture()
def rag_faithfulness_evaluator_run_inputs():
    return {
        "question_key": "List 6 movies about witches in the genre of fiction.",
        "contexts_key": [
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
        "answer_key": 'Witches in fiction are depicted through a mix of horror, fantasy, and dark comedy. \n\n"The Craft" (1996) delves into the complexities of teenage witchcraft, showcasing both empowerment and the darker repercussions of their actions.  \n"Snow White: A Tale of Terror" (1997) offers a sinister twist on the classic story, highlighting the witch\'s envy and vengeful nature.  \n"Hocus Pocus" (1993) delivers a comedic and adventurous take on witchcraft, as three resurrected witches wreak havoc in contemporary Salem',
    }


@pytest.fixture()
def custom_code_snippet():
    return "from typing import Dict\nfrom random import uniform\n\ndef evaluate(\n    app_params: Dict[str, str],\n    inputs: Dict[str, str],\n    output: str,  # output of the llm app\n    datapoint: Dict[str, str]  # contains the testset row\n) -> float:\n    return uniform(0.1, 0.9)"


@pytest.fixture()
def evaluators_payload_data(custom_code_snippet):
    prompt_template = "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below:\nEvaluation strategy: 0 to 10 0 is very bad and 10 is very good.\nPrompt: {llm_app_prompt_template}\nInputs: country: {country}\nExpected Answer Column:{correct_answer}\nEvaluate this: {variant_output}\n\nAnswer ONLY with one of the given grading or evaluation options."
    return {
        "auto_regex_test": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {
                "regex_pattern": r"The\s+answer\s+is\s+42[.,]?",
                "regex_should_match": True,
            },
        },
        "field_match_test": {
            "inputs": {
                "ground_truth": {"message": "The correct answer is 42"},
                "prediction": '{"message": "The correct answer is 42"}',
            },
            "settings": {"json_field": "ground_truth"},
        },
        "auto_custom_code_run": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
                "app_config": {},
            },
            "settings": {
                "code": custom_code_snippet,
                "correct_answer_key": "correct_answer",
            },
        },
        "auto_ai_critique": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {
                "prompt_template": prompt_template,
                "correct_answer_key": "correct_answer",
            },
            "credentials": {"OPENAI_API_KEY": env.llm.openai},
        },
        "auto_starts_with": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"prefix": "The", "case_sensitive": False},
        },
        "auto_ends_with": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"suffix": "42", "case_sensitive": False},
        },
        "auto_contains": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"substring": "answer is", "case_sensitive": False},
        },
        "auto_contains_any": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"substrings": "The,answer,42", "case_sensitive": False},
        },
        "auto_contains_all": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"substrings": "The,answer,is,42", "case_sensitive": False},
        },
        "auto_contains_json": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": '{"message": "The answer is 42"}',
            },
        },
        "auto_json_diff": {
            "inputs": {
                "ground_truth": '{"message": "The correct answer is 42"}',
                "prediction": '{"message": "The answer is 42"}',
            },
            "settings": {
                "compare_schema_only": True,
                "predict_keys": True,
                "case_insensitive_keys": False,
            },
        },
        "auto_levenshtein_distance": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {"threshold": 0.4},
        },
        "auto_similarity_match": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "settings": {
                "similarity_threshold": 0.4,
                "correct_answer_key": "correct_answer",
            },
        },
        "auto_semantic_similarity": {
            "inputs": {
                "ground_truth": "The correct answer is 42",
                "prediction": "The answer is 42",
            },
            "credentials": {"OPENAI_API_KEY": env.llm.openai},
        },
    }
