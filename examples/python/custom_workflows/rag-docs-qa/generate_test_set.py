import os
import glob
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from litellm import completion
import frontmatter
import tqdm
import json

# Load environment variables
load_dotenv()


def get_files(docs_path):
    """Get all markdown files recursively."""
    return


def extract_content(file_path):
    """Extract content from markdown file."""
    with open(file_path, "r", encoding="utf-8") as f:
        post = frontmatter.load(f)
        # Get title from frontmatter or filename
        title = post.get("title", Path(file_path).stem)
        # Get content without frontmatter
        content = post.content
        return title, content


def generate_questions(title, content):
    """Generate questions using OpenAI."""
    system_prompt = """You are a helpful assistant that generates questions based on documentation content.
    Generate 5 questions that could be answered using the provided documentation.
    Your response must be a JSON object with a single key "questions" containing an array of strings."""

    user_prompt = f"""
    Title: {title}
    
    Content: {content}  # Limit content length to avoid token limits
    
    Generate 5 questions about this documentation. Put yourself in the shoes of a user attempting to 1) figure how to use the product for a use case 2) troubleshoot an issue 3) learn about the features of the product. 
    The user in this case is a technical user (AI engineer) who is trying to build an llm application.
    The user would write the questions they would ask in a chat with a human. Therefore, not all questions will be clear and well written. 
    """

    try:
        response = completion(
            model="gpt-3.5-turbo-0125",  # Using the latest model that supports JSON mode
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )

        # Check if the response was complete
        if response.choices[0].finish_reason == "length":
            print(f"Warning: Response was truncated for {title}")
            return []

        # Parse JSON response - no need for eval()
        result = json.loads(response.choices[0].message.content)
        return result["questions"]

    except Exception as e:
        print(f"Error generating questions for {title}: {str(e)}")
        return []


def main():
    docs_path = os.getenv("DOCS_PATH")
    if not docs_path:
        raise ValueError("DOCS_PATH environment variable not set")

    # Get all files
    files = glob.glob(os.path.join(docs_path, "**/*.mdx"), recursive=True)
    all_questions = []
    # Process each file
    for file_path in tqdm.tqdm(files, desc="Processing documentation files"):
        if "/reference/api" in file_path:
            # skip api docs
            continue
        try:
            title, content = extract_content(file_path)
            questions = generate_questions(title, content)
            all_questions.extend(questions)
        except Exception as e:
            print(f"Error processing {file_path}: {str(e)}")
            continue

    # Save to CSV
    df = pd.DataFrame({"query": all_questions})
    df.to_csv("test_set.csv", index=False, lineterminator="\n")
    print(f"Generated {len(all_questions)} questions and saved to test_set.csv")


if __name__ == "__main__":
    main()
