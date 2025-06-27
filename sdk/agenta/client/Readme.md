# Common Fern Issues with Pydantic Models

When using Fern to generate SDKs from FastAPI applications with Pydantic models, you may encounter several issues related to model naming conflicts, schema generation, and recursive type definitions. This document outlines the most common problems and their solutions.

## Issue 1: Model Name Conflicts

### Problem Description

When you have multiple Pydantic models with the same name across different modules/folders and are used by different endpoints, Fern merges them into a single schema, causing field conflicts and unexpected behaviour.

**Example:**
```python
# users/models.py
class User(BaseModel):
    id: int
    username: str
    email: str

# admin_users/models.py  
class User(BaseModel):
    id: int
    username: str
    permissions: List[str]
    is_admin: bool
```

Fern will merge these into one `User` schema, and when you run the `fern generate` command, it results in an error that involves conflicting field definitions.

### Solutions

#### Solution 1: Use Unique Model Names

Rename your models to be more specific and avoid conflicts:

```python
# users/models.py
class RegularUser(BaseModel):
    id: int
    username: str
    email: str

# admin_users/models.py
class AdminUser(BaseModel):
    id: int
    username: str
    permissions: List[str]
    is_admin: bool
```

#### Solution 2: Use Pydantic's `model_config` with Custom Titles

Override the schema title to make models unique:

```python
# users/models.py
class User(BaseModel):
    model_config = ConfigDict(title="RegularUser")
    
    id: int
    username: str
    email: str

# admin_users/models.py
class User(BaseModel):
    model_config = ConfigDict(title="AdminUser")
    
    id: int
    username: str
    permissions: List[str]
    is_admin: bool
```

#### Solution 3: Use Module-Prefixed Aliases

Create type aliases that include module context:

```python
# users/models.py
class User(BaseModel):
    id: int
    username: str
    email: str

# Create an alias for external use
UserModel = User

# admin_users/models.py
class User(BaseModel):
    id: int
    username: str
    permissions: List[str]
    is_admin: bool

# Create an alias for external use
AdminUserModel = User
```

Then use the aliases in your endpoints:

```python
from users.models import UserModel
from admin_users.models import AdminUserModel

@app.get("/users/{user_id}", response_model=UserModel)
async def get_user(user_id: int):
    # ...

@app.get("/admin/users/{user_id}", response_model=AdminUserModel)
async def get_admin_user(user_id: int):
    # ...
```

## Issue 2: Enum Schema Generation

### Problem Description

When multiple Pydantic models reference the same Enum, Fern doesn't create a shared enum schema and instead inlines the enum values in each model, leading to code duplication and inconsistency.

**Example:**
```python
class Status(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"

class User(BaseModel):
    id: int
    status: Status

class Order(BaseModel):
    id: int
    status: Status  # Same enum, but Fern will not reuse the schema
```

### Solutions

#### Solution 1: Explicit Schema Registration

Force Pydantic to generate a proper schema reference by using the enum in a standalone model first:

```python
from enum import Enum
from typing import Union
from pydantic import BaseModel

class Status(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"

# Create a dedicated schema model
class StatusSchema(BaseModel):
    status: Status

class User(BaseModel):
    id: int
    status: Status

class Order(BaseModel):
    id: int
    status: Status
```

#### Solution 2: Use Field with Schema Customization

Customize the field schema to ensure proper enum handling:

```python
from pydantic import BaseModel, Field
from enum import Enum

class Status(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive" 
    PENDING = "pending"

class User(BaseModel):
    id: int
    status: Status = Field(
        ...,
        json_schema_extra={
            "$ref": "#/components/schemas/Status"
        }
    )

class Order(BaseModel):
    id: int
    status: Status = Field(
        ..., 
        json_schema_extra={
            "$ref": "#/components/schemas/Status"
        }
    )
```

## Issue 3: Recursive Type Definitions

### Problem Description

When using recursive type definitions with Pydantic v2 and Fern-generated SDKs, you may encounter infinite recursion during schema generation. This happens particularly with self-referential or mutually recursive types, such as JSON structures that can contain nested versions of themselves.

**Example of problematic recursive type definitions:**

```python
from typing_extensions import TypeAliasType
from typing import Union, Dict, List

# This approach causes infinite recursion during schema generation
OTelJson: TypeAliasType = TypeAliasType(
    "OTelJson",
    Union[str, int, float, bool, None, Dict[str, "OTelJson"], List["OTelJson"]],
)

OTelNumericJson: TypeAliasType = TypeAliasType(
    "OTelNumericJson",
    Union[int, float, Dict[str, "OTelNumericJson"], List["OTelNumericJson"]],
)
```

Despite `TypeAliasType` being recommended in Pydantic v2 documentation for recursive types, it doesn't work well with Fern-generated models because:

1. Fern's model generation may not properly handle these recursive references
2. During schema generation, Pydantic attempts to expand these types infinitely
3. Runtime errors occur during initialization or when creating JSON schemas

### Solutions

#### Solution: Break Recursion with `Any` Type

Replace recursive self-references with `Any` for dictionary values and list items:

```python
from typing import Any, Union, Dict, List

# Safe non-recursive version that prevents schema generation issues
OTelJson = Union[str, int, float, bool, None, Dict[str, Any], List[Any]]

# Using Any to break recursion cycle during schema generation
OTelNumericJson = Union[int, float, Dict[str, Any], List[Any]]
```

#### Why This Works

1. **Breaks the recursion cycle**: Using `Any` eliminates the self-reference that causes infinite recursion
2. **Maintains functionality**: The types still functionally represent nested JSON structures
3. **No schema generation issues**: Pydantic can generate schemas without infinite expansion
4. **Simple implementation**: Requires no complex patches or runtime modifications

#### What to Avoid

1. **Don't use complex monkey patching**: Patching Pydantic internals to handle recursion is fragile
2. **Avoid disabling schema generation globally**: This impacts all models and API documentation
3. **Don't use custom serialization for every model**: Introduces unnecessary complexity

When Fern generates your SDK, always check for recursive type definitions and convert them to use `Any` at appropriate recursion points to prevent these issues.


## Troubleshooting

### Debug Schema Generation

Add debugging to see what schemas are being generated:

```python
import json
from your_app import app

# Generate and inspect OpenAPI schema
schema = app.openapi()
with open("debug_openapi.json", "w") as f:
    json.dump(schema, f, indent=2)

# Check for duplicate schemas
schemas = schema.get("components", {}).get("schemas", {})
print("Generated schemas:", list(schemas.keys()))
```

### Common Error Patterns

1. **"Schema conflict"** - Usually indicates duplicate model names
2. **"Enum already exists"** - Enum not properly registered in other components/schemas
3. **"Field type mismatch"** - Different models with same name have conflicting fields
