import re
from nbconvert import MarkdownExporter
from nbconvert.preprocessors import ClearOutputPreprocessor
import nbformat
import os
import sys


def make_header(notebook_path):
    github_uri = "Agenta-AI/agenta/blob/main/cookbook"
    github_path = f"https://github.com/{github_uri}/{os.path.basename(notebook_path)}"

    return f"""

:::note
  This guide is also available as a [Jupyter Notebook]({github_path}).
:::

"""


def convert_to_title_case(filename):
    # Remove extension and replace underscores or hyphens with spaces
    title = re.sub(r"[_-]", " ", os.path.splitext(filename)[0])
    # Capitalize only the first letter of the title
    title_case_title = title.capitalize()
    return title_case_title


def clear_outputs(notebook_path):
    # Load the notebook
    with open(notebook_path, "r", encoding="utf-8") as f:
        notebook = nbformat.read(f, as_version=4)

    # Apply ClearOutputPreprocessor to remove cell outputs
    clear_output = ClearOutputPreprocessor()
    clear_output.preprocess(notebook, {})

    # Save the cleared notebook (in-place)
    with open(notebook_path, "w", encoding="utf-8") as f:
        nbformat.write(notebook, f)


def export_notebook(notebook_path, output_path):
    # Clear outputs before converting
    clear_outputs(notebook_path)

    # Set up MarkdownExporter and export the notebook
    exporter = MarkdownExporter()
    output, resources = exporter.from_filename(notebook_path)

    # Get the title in Title Case with spaces
    title = convert_to_title_case(os.path.basename(notebook_path))

    # Add the title to the top of the markdown file
    title_header = f'---\ntitle: "{title}"\n---\n\n'

    # Add the header below the title
    header = make_header(notebook_path)

    # Combine the title, header, and the output markdown content
    output = title_header + header + output

    extract_meta = ""
    meta_mark_start = "<!-- docusaurus_head_meta::start\n"
    meta_mark_end = "docusaurus_head_meta::end -->\n"
    if meta_mark_start in output and meta_mark_end in output:
        start = output.index(meta_mark_start)
        end = output.index(meta_mark_end)
        extract_meta = output[start + len(meta_mark_start) : end]
        output = output[:start] + output[end + len(meta_mark_end) :]

    output = extract_meta + output

    # Write the output markdown file
    with open(output_path, "w") as f:
        f.write(output)


def export_all_notebooks_in_primary_dir():
    for filename in os.listdir("../cookbook"):
        if filename.endswith(".ipynb"):
            export_notebook(
                f"../cookbook/{filename}",
                f"./docs/guides/cookbooks/{filename.replace('.ipynb', '.mdx')}",
            )


def main(notebook_filename=None):
    if notebook_filename:
        # Export a specific notebook
        if os.path.exists(f"../cookbook/{notebook_filename}"):
            export_notebook(
                f"../cookbook/{notebook_filename}",
                f"./docs/guides/cookbooks/{notebook_filename.replace('.ipynb', '.mdx')}",
            )
        else:
            print(f"Notebook {notebook_filename} not found in ../cookbook/ directory.")
    else:
        # Export all notebooks
        export_all_notebooks_in_primary_dir()


if __name__ == "__main__":
    # Get the filename argument from the command line
    notebook_filename = sys.argv[1] if len(sys.argv) > 1 else None
    main(notebook_filename)
