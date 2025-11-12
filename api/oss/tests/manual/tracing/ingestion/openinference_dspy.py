# /// script
# dependencies = ["agenta", "dspy", "openinference-instrumentation-dspy"]
# ///

import agenta as ag
import dspy
from dotenv import load_dotenv
from openinference.instrumentation.dspy import DSPyInstrumentor

load_dotenv(override=True)

ag.init()

DSPyInstrumentor().instrument()


lm = dspy.LM("openai/gpt-4o")
dspy.configure(lm=lm)


# Use case 1: Math reasoning with Chain of Thought (CoT)
@ag.instrument()
def math_reasoning(question: str):
    cot = dspy.ChainOfThought("question -> answer: float")
    response = cot(question=question)
    return response


# Use case 2: Retrieval-Augmented Generation (RAG) with Wikipedia search
@ag.instrument(spankind="query")
def search_wikipedia(query: str) -> list[str]:
    results = dspy.ColBERTv2(url="http://20.102.90.50:2017/wiki17_abstracts")(
        query, k=3
    )
    return [x["text"] for x in results]


@ag.instrument()
def rag(question: str):
    cot = dspy.ChainOfThought("context, question -> response")
    response = cot(context=search_wikipedia(question), question=question)
    return response


# Use case 3: Drafting an article with an outline and sections
class Outline(dspy.Signature):
    """Outline a thorough overview of a topic."""

    topic: str = dspy.InputField()
    title: str = dspy.OutputField()
    sections: list[str] = dspy.OutputField()
    section_subheadings: dict[str, list[str]] = dspy.OutputField(
        desc="mapping from section headings to subheadings"
    )


class DraftSection(dspy.Signature):
    """Draft a top-level section of an article."""

    topic: str = dspy.InputField()
    section_heading: str = dspy.InputField()
    section_subheadings: list[str] = dspy.InputField()
    content: str = dspy.OutputField(desc="markdown-formatted section")


class DraftArticle(dspy.Module):
    def __init__(self):
        self.build_outline = dspy.ChainOfThought(Outline)
        self.draft_section = dspy.ChainOfThought(DraftSection)

    def forward(self, topic: str):
        outline = self.build_outline(topic=topic)
        sections = []
        for heading, subheadings in outline.section_subheadings.items():
            section, subheadings = f"## {heading}", [
                f"### {subheading}" for subheading in subheadings
            ]
            section = self.draft_section(
                topic=outline.title,
                section_heading=section,
                section_subheadings=subheadings,
            )
            sections.append(section.content)
        return dspy.Prediction(title=outline.title, sections=sections)


@ag.instrument()
def journalist(topic: str):
    draft_article = DraftArticle()
    article = draft_article(topic=topic)
    return article


if __name__ == "__main__":
    # Use case 1: Math reasoning
    response = math_reasoning("What is 2 + 2?")
    print("Math response:", response)

    # Use case 2: RAG with Wikipedia
    rag_response = rag("What's the name of the castle that David Gregory inherited?")
    print("RAG response:", rag_response)

    # Use case 3: Article generation
    article = journalist("The impact of AI on society")
    print("Article generation response:", article)
