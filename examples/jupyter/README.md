# Convert Cookbook (`.ipynb`) to Markdown Files

## Prerequisites

1. **Python Environment**: Ensure you have Python 3.x installed.

2. **Install Required Packages**: 
   ```bash
   pip install nbconvert
   ```

## Conversion Instructions

You can convert `.ipynb` files to markdown format using the provided script. Below are two methods: converting all cookbook at once or converting a single notebook.


### 1. First get inside the `website` directory:
```bash
cd ./website
 ```

### 2. Convert All cookbooks

To convert all files inside the `cookbook` directory, run following command:
```bash
make generate_cookbook_docs
```

### 3. Convert a single cookbook file

To convert a single cookbook file, you can specify the filename during the `make` command:
```bash
make generate_cookbook_docs file=example.ipynb
```
   
> All the converted `.ipynb` files will store in the `docs/guides/cookbooks/` directory


## Notes

- If a file already exists, it will be skipped during generations. To override this, simply add `force=true` at the end of the command.

-  The output markdown files will include an optional note with links to the original Jupyter notebook on GitHub.
  
