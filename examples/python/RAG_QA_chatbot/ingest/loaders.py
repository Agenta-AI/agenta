"""Document loaders for different file types."""

import glob
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List

import frontmatter


@dataclass
class Document:
    """A document with content and metadata."""

    content: str
    title: str
    url: str
    file_path: str


def load_mdx(docs_path: str, base_url: str) -> List[Document]:
    """
    Load all MDX files from a directory.

    Args:
        docs_path: Path to the docs directory
        base_url: Base URL for generating doc links

    Returns:
        List of Document objects
    """
    documents = []
    mdx_files = glob.glob(os.path.join(docs_path, "**/*.mdx"), recursive=True)

    for file_path in mdx_files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                post = frontmatter.load(f)

                # Get title from frontmatter or filename
                title = post.get("title", Path(file_path).stem)

                # Convert file path to URL
                relative_path = os.path.relpath(file_path, docs_path)
                url_path = os.path.splitext(relative_path)[0]
                url = f"{base_url.rstrip('/')}/{url_path}"

                documents.append(
                    Document(
                        content=post.content, title=title, url=url, file_path=file_path
                    )
                )
        except Exception as e:
            print(f"Warning: Failed to load {file_path}: {e}")
            continue

    return documents
