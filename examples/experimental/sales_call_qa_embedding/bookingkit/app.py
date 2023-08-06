import agenta as ag
from langchain.chains import LLMChain
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate
import langchain

default_prompt = "Write me a description for this event {event_name} in this {lang} language. The vendor name is {vendor_name}. Use this {vendor_input}. The answer length should be {answer_length}. Use this {tone}"
professional_tone_prompt = "If it’s professional tone then: be professional"
adventurous_tone_prompt = "If it’s adventurous tone then: be adventurous"
fun_tone_prompt = "If it’s fun tone then: be fun"
wild_tone_prompt = "If it’s wild tone then: be wild"
default_tone = "Professional and serious"


@ag.post
def generate(
    event_name: str,
    vendor_name: str,
    lang: str,
    vendor_input: str,
    answer_length: str,
    tone: str = default_tone,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
    professional_tone_prompt: ag.TextParam = professional_tone_prompt,
    adventurous_tone_prompt: ag.TextParam = adventurous_tone_prompt,
    fun_tone_prompt: ag.TextParam = fun_tone_prompt,
    wild_tone_prompt: ag.TextParam = wild_tone_prompt,
) -> str:
    langchain.verbose = True
    llm = ChatOpenAI(temperature=temperature, model_name="gpt-3.5-turbo")
    prompt_template_final = prompt_template
    if tone == "Professional and serious":
        print(prompt_template)
        prompt_template_final = prompt_template.replace(
            "{tone}", professional_tone_prompt
        )
    elif tone == "Adventurous and enthusiastic":
        prompt_template_final = prompt_template.replace(
            "{tone}", adventurous_tone_prompt
        )
    elif tone == "Playful and fun":
        prompt_template_final = prompt_template.replace("{tone}", fun_tone_prompt)
    elif tone == "Wacky and wild":
        prompt_template_final = prompt_template.replace("{tone}", wild_tone_prompt)
    prompt = PromptTemplate(
        input_variables=[
            "vendor_name",
            "lang",
            "event_name",
            "vendor_input",
            "tone",
            "answer_length",
        ],
        template=prompt_template_final,
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    output = chain.run(
        vendor_name=vendor_name,
        lang=lang,
        event_name=event_name,
        vendor_input=vendor_input,
        tone=tone,
        answer_length=answer_length,
    )
    return output
