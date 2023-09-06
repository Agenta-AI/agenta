import openai
import agenta as ag
from pytube import YouTube
from langchain.llms import OpenAI
from langchain.chains.llm import LLMChain
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI
from pytube.exceptions import VideoUnavailable
from langchain.chains.mapreduce import MapReduceChain
from youtube_transcript_api import YouTubeTranscriptApi
from langchain.text_splitter import CharacterTextSplitter
from langchain.chains.summarize import load_summarize_chain
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chains.combine_documents.stuff import StuffDocumentsChain
from langchain.chains import ReduceDocumentsChain, MapReduceDocumentsChain

default_prompt = "Create a blog post from the YouTube Video: {youtube_url}"

map_template = """The following is a set of transcripts from a youtube video:
    {transcripts}
    Based on these transcripts, summarise the content. 
    Summary:
"""

reduce_template = """The following is set of summaries:
    {transcripts_summaries}
    Take these and distill it into a final, consolidated summary. 
    Answer:
"""

replicate_dict = {
    "replicate/llama-2-7b-chat": "a16z-infra/llama-2-7b-chat:4f0b260b6a13eb53a6b1891f089d57c08f41003ae79458be5011303d81a394dc",
    "replicate/llama-2-70b-chat": "replicate/llama-2-70b-chat:2c1608e18606fad2812020dc541930f2d0495ce32eee50074220b87300bc16e1",
    "replicate/llama-2-13b-chat": "a16z-infra/llama-2-13b-chat:2a7f981751ec7fdf87b5b91ad4db53683a98082e9ff7bfd12c8cd5ea85980a52",
}

OPENAI_CHOICES = [
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo-16k-0613",
    "gpt-4",
]

@ag.post
def generate(
    youtube_url: str,
    prompt_template: ag.TextParam = default_prompt,
    map_template: ag.TextParam = map_template,
    reduce_template: ag.TextParam = reduce_template,
    temperature: ag.FloatParam = 0.9,
    maximum_length: ag.IntParam = ag.IntParam(100, 0, 4000),
    model: ag.MultipleChoiceParam = ag.MultipleChoiceParam(
        "gpt-3.5-turbo",
        OPENAI_CHOICES + list(replicate_dict.keys()),
    ),
) -> str:
    
    if is_valid_youtube_url(youtube_url):
        
        try:
            
            model_parameters = {
                "model": model,
                "temperature": temperature,
                "prompt_template": prompt_template,
                "tokens": maximum_length
            }
            
            transcript = fetch_video_transcript(youtube_url)
            video_title, video_description = extract_video_info(youtube_url)
            
            blog_post = generate_blog_post(video_title, video_description, transcript, map_template, reduce_template, model_parameters)

            return str(blog_post)
            
        except Exception as e:
            raise Exception(e)        
        
    else:
        raise ValueError("Please enter a valid YouTube video URL.")
    

def is_valid_youtube_url(youtube_url: str) -> bool:
    # Check if the URL is a valid YouTube video URL
    try:
        # Create a YouTube object
        yt = YouTube(youtube_url)

        # Check if the video is available
        if not yt.video_id:
            return False

    except (VideoUnavailable, Exception):
        return False

    # Return True if the video is available
    return yt.streams.filter(adaptive=True).first() is not None

# Function to extract video content from a YouTube URL
def extract_video_info(youtube_url):
    try:
        # Create a YouTube object for the specified URL
        yt = YouTube(youtube_url)

        # Get the video title and description
        video_title = yt.title
        video_description = yt.description

        return video_title, video_description

    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return None, None

# Function to fetch the transcript of a YouTube video
def fetch_video_transcript(youtube_url):
    video_id = youtube_url.split("?v=")[1]
    transcript = YouTubeTranscriptApi.get_transcript(video_id)
    return transcript

# Function to generate a blog post from video title and transcript using llm models
def generate_blog_post(video_title, video_description, transcript, map_template, reduce_template, model_parameters):
    
    model = model_parameters.get("model")
    temperature = model_parameters.get("temperature")
    prompt = model_parameters.get("prompt_template")
    model_tokens = model_parameters.get("tokens")
    generated_transcript = transcript
    
    if model in OPENAI_CHOICES:
        
        llm = ChatOpenAI(
            model=model,
            temperature=temperature,
        )
        
        # Map
        map_prompt = PromptTemplate(
            input_variables=["transcripts"],
            template=map_template
        )
        map_chain = LLMChain(llm=llm, prompt=map_prompt)
        
        # # Define StuffDocumentsChain
        # stuff_chain = StuffDocumentsChain(
        #     llm_chain=map_chain, document_variable_name="transcripts"
        # )

        # text_splitter = RecursiveCharacterTextSplitter(chunk_size=5000, chunk_overlap=50)
        # chunks = text_splitter.create_documents([str(generated_transcript)])
        # generated_transcript_summary = stuff_chain.run(chunks)
        
        # # When I use this, I get the error
        # """
        # 1 validation error for LLMChain
        # llm
        # Can't instantiate abstract class BaseLanguageModel with abstract methods agenerate_prompt, apredict, apredict_messages, generate_prompt, invoke, predict, predict_messages (type=type_error)
        # """
        # chain = load_summarize_chain(map_chain, chain_type="map_reduce", verbose=False)
        # generated_transcript_summary = chain.run(chunks)
    

        # The result of Reduce output None
        # # Reduce
        reduce_prompt = PromptTemplate(
            input_variables=["transcripts_summaries"],
            template=reduce_template
        )
        reduce_chain = LLMChain(llm=llm, prompt=reduce_prompt)

        # Takes a list of documents, combines them into a single string, and passes this to an LLMChain
        combine_documents_chain = StuffDocumentsChain(
            llm_chain=reduce_chain, 
            document_prompt=reduce_prompt,
            document_variable_name="transcripts_summaries"
        )

        # Combines and iteravely reduces the mapped documents
        reduce_documents_chain = ReduceDocumentsChain(
            # This is final chain that is called.
            combine_documents_chain=combine_documents_chain,
            # If documents exceed context for `StuffDocumentsChain`
            collapse_documents_chain=combine_documents_chain,
            # The maximum number of tokens to group documents into.
            # token_max=4000,
        )

        # Combining documents by mapping a chain over them, then combining results
        map_reduce_chain = MapReduceDocumentsChain(
            # Map chain
            llm_chain=map_chain,
            # Reduce chain
            reduce_documents_chain=reduce_documents_chain,
            # The variable name in the llm_chain to put the documents in
            document_variable_name="transcripts",
            # Return the results of the map steps in the output
            return_intermediate_steps=False,
        )

        text_splitter = CharacterTextSplitter.from_tiktoken_encoder(
            chunk_size=1000, chunk_overlap=0
        )
        split_docs = text_splitter.create_documents(str(generated_transcript))
        
        generated_output = map_reduce_chain.run(split_docs)
        # return str(generated_output)
    
        # For some reasons, this returns 'None'
        final_template = "Create a blog post from the following video title:\n {video_title} \n, video description:\n {video_description} \n\nTranscript:\n{generated_transcript_summary}\n\nBlog Post:"
        final_prompt = PromptTemplate(template=final_template, input_variables=["video_title", "video_description", "generated_transcript_summary"])
        
        final_chain = LLMChain(prompt=final_prompt, llm=llm)
        final_response = final_chain.run(
            video_title=video_title,
            video_description=video_description,
            generated_transcript_summary=generated_output
        )
        
        return final_response

    # replicate
    if model.startswith("replicate"):
            pass # pass for now. 
    