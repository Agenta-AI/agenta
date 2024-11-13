import certifi
from dotenv import dotenv_values
from pymongo import MongoClient
from pymongo.server_api import ServerApi
from openai import OpenAI

import agenta as ag

config = dotenv_values(".env")

openai = OpenAI(api_key=config["OPENAI_API_KEY"])

mongodb = MongoClient(
    config["MONGODB_ATLAS_URI"], tlsCAFile=certifi.where(), server_api=ServerApi("1")
)
db = mongodb[config["MONGODB_DATABASE_NAME"]]

ag.init()

ag.config.default(
    # RETRIEVER
    retriever_prompt=ag.TextParam("Movies about {topic} in the genre of {genre}."),
    retriever_multiplier=ag.FloatParam(default=3, minval=1, maxval=10),
    # GENERATOR
    generator_context_prompt=ag.TextParam(
        "Given the following list of suggested movies:\n\n{movies}"
    ),
    generator_instructions_prompt=ag.TextParam(
        "Provide a list of {count} movies about {topic} in the genre of {genre}."
    ),
    generator_model=ag.MultipleChoiceParam(
        "gpt-3.5-turbo", ["gpt-4o-mini", "gpt-3.5-turbo"]
    ),
    generator_temperature=ag.FloatParam(default=0.8),
    # SUMMARIZER
    summarizer_context_prompt=ag.TextParam(
        "Act as a professional cinema critic.\nBe concise and factual.\nUse one intro sentence, and one sentence per movie."
    ),
    summarizer_instructions_prompt=ag.TextParam(
        "Summarize the following recommendations about {topic} in the genre of {genre}:\n\n{report}"
    ),
    summarizer_model=ag.MultipleChoiceParam(
        "gpt-4o-mini", ["gpt-4o-mini", "gpt-3.5-turbo"]
    ),
    summarizer_temperature=ag.FloatParam(default=0.2),
)


@ag.instrument(
    spankind="EMBEDDING",
    ignore_inputs=["description"],
    ignore_outputs=["embedding", "cost", "usage"],
)
def embed(description: str):
    response = openai.embeddings.create(
        input=description, model="text-embedding-ada-002"
    )
    return {
        "embedding": response.data[0].embedding,
        "cost": ag.calculate_token_usage(
            "text-embedding-ada-002", response.usage.dict()
        ),
        "usage": response.usage.dict(),
    }


@ag.instrument(spankind="SEARCH", ignore_inputs=True, ignore_outputs=True)
def search(query: list, topk: int):
    embeddings = db["embedded_movies"]

    pipeline = [
        {
            "$vectorSearch": {
                "index": "semantic_similarity_search_index",
                "path": "plot_embedding",
                "queryVector": query,
                "numCandidates": 200,
                "limit": topk,
            }
        },
        {"$project": {"_id": 0, "title": 1, "genres": 1, "plot": 1, "year": 1}},
    ]

    movies = [movie for movie in embeddings.aggregate(pipeline)]

    return movies


@ag.instrument(spankind="MESSAGE")
async def chat(prompts: str, opts: dict):
    response = openai.chat.completions.create(
        model=opts["model"],
        temperature=opts["temperature"],
        messages=[
            {"role": agent, "content": prompt} for (agent, prompt) in prompts.items()
        ],
    )

    return {
        "message": response.choices[0].message.content,
        "cost": ag.calculate_token_usage(opts["model"], response.usage.dict()),
        "usage": response.usage.dict(),
    }


@ag.instrument(spankind="RETRIEVER", ignore_inputs=True)
async def retriever(topic: str, genre: str, count: int) -> dict:
    prompt = ag.config.retriever_prompt.format(topic=topic, genre=genre)
    topk = count * ag.config.retriever_multiplier

    ag.tracing.store_internals({"prompt": prompt})

    query = embed(prompt)

    result = search(query["embedding"], topk)

    movies = [
        f"{movie['title']} ({movie['year']}) in {movie['genres']}: {movie['plot']}"
        for movie in result
    ]

    return {"movies": movies}


@ag.instrument(spankind="GENERATOR", ignore_inputs=True)
async def reporter(topic: str, genre: str, count: int, movies: dict) -> dict:
    context = ag.config.generator_context_prompt.format(movies="\n".join(movies))
    instructions = ag.config.generator_instructions_prompt.format(
        count=count, topic=topic, genre=genre
    )

    prompts = {"system": context, "user": instructions}
    opts = {
        "model": ag.config.generator_model,
        "temperature": ag.config.generator_temperature,
    }

    result = await chat(prompts, opts)

    report = result["message"]

    return {"report": report}


@ag.instrument(spankind="GENERATOR", ignore_inputs=True)
async def summarizer(topic: str, genre: str, report: dict) -> dict:
    context = ag.config.summarizer_context_prompt
    instructions = ag.config.summarizer_instructions_prompt.format(
        topic=topic, genre=genre, report=report
    )

    prompts = {"system": context, "user": instructions}
    opts = {
        "model": ag.config.summarizer_model,
        "temperature": ag.config.summarizer_temperature,
    }

    result = await chat(prompts, opts)

    report = result["message"]

    return {"report": report}


@ag.entrypoint
@ag.instrument(spankind="WORKFLOW")
async def rag(topic: str, genre: str, count: int = 5):
    count = int(count)

    result = await retriever(topic, genre, count)

    result = await reporter(topic, genre, count, result["movies"])

    result = await summarizer(topic, genre, result["report"])

    result = await summarizer(topic, genre, result["report"])

    return result["report"]
