"""Text chunking utilities."""

from typing import List


def chunk_text(text: str, max_chunk_size: int = 1500) -> List[str]:
    """
    Split text into chunks based on paragraphs and size.
    Tries to maintain context by keeping paragraphs together when possible.

    Args:
        text: The text to chunk
        max_chunk_size: Maximum size of each chunk in characters

    Returns:
        List of text chunks
    """
    # Split by double newlines to preserve paragraph structure
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk = []
    current_size = 0

    for paragraph in paragraphs:
        paragraph_size = len(paragraph)

        # If a single paragraph is too large, split it by sentences
        if paragraph_size > max_chunk_size:
            # Save current chunk first
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_size = 0

            sentences = [s.strip() + "." for s in paragraph.split(".") if s.strip()]
            for sentence in sentences:
                if len(sentence) > max_chunk_size:
                    # If even a sentence is too long, split by size
                    for i in range(0, len(sentence), max_chunk_size):
                        chunks.append(sentence[i : i + max_chunk_size])
                elif current_size + len(sentence) > max_chunk_size:
                    if current_chunk:
                        chunks.append(" ".join(current_chunk))
                    current_chunk = [sentence]
                    current_size = len(sentence)
                else:
                    current_chunk.append(sentence)
                    current_size += len(sentence)
        # If adding this paragraph would exceed the limit, start a new chunk
        elif current_size + paragraph_size > max_chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [paragraph]
            current_size = paragraph_size
        else:
            current_chunk.append(paragraph)
            current_size += paragraph_size

    # Add the last chunk if it exists
    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return [c for c in chunks if c.strip()]  # Filter empty chunks
