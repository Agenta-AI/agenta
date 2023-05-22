from fastapi import HTTPException, APIRouter
from deploy_server.models.api.app_evaluation_model import ComparisonTable, EvaluationRow, EvaluationRowUpdate, ComparisonTableUpdate
from deploy_server.services.db_mongo import comparison_tables, evaluation_rows
from datetime import datetime
from bson import ObjectId
from typing import List
import logging

router = APIRouter()


@router.post("/", response_model=ComparisonTable)
async def create_comparison_table():
    """Creates an empty comparison table document

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    comparison_table = dict()
    comparison_table["created_at"] = comparison_table["updated_at"] = datetime.utcnow()
    result = await comparison_tables.insert_one(comparison_table)
    if result.acknowledged:
        comparison_table["id"] = str(result.inserted_id)
        return comparison_table
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")


@router.put("/{comparison_table_id}")
async def update_comparison_table(comparison_table_id: str, comparison_table: ComparisonTableUpdate):
    """Updates a comparison table 

    Arguments:
        comparison_table_id -- _description_
        comparison_table -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    comparison_table_dict = comparison_table.dict()
    comparison_table_dict["updated_at"] = datetime.utcnow()
    result = await comparison_tables.update_one(
        {'_id': ObjectId(comparison_table_id)},
        {'$set': {'variants': comparison_table_dict["variants"]}}
    )
    if result.acknowledged:
        return comparison_table_dict
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")


@router.post("/{comparison_table_id}/evaluation_row", response_model=EvaluationRow)
async def create_evaluation_row(evaluation_row: EvaluationRow):
    """Creates an empty evaluation row

    Arguments:
        evaluation_row -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation_row_dict = evaluation_row.dict()
    evaluation_row_dict.pop("id", None)

    evaluation_row_dict["created_at"] = evaluation_row_dict["updated_at"] = datetime.utcnow()
    result = await evaluation_rows.insert_one(evaluation_row_dict)
    if result.acknowledged:
        evaluation_row_dict["id"] = str(result.inserted_id)
        return evaluation_row_dict
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")


@router.put("/{comparison_table_id}/evaluation_row/{evaluation_row_id}")
async def update_evaluation_row(evaluation_row_id: str, evaluation_row: EvaluationRowUpdate):
    """Updates an evaluation row with a vote

    Arguments:
        evaluation_row_id -- _description_
        evaluation_row -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation_row_dict = evaluation_row.dict()
    evaluation_row_dict["updated_at"] = datetime.utcnow()
    result = await evaluation_rows.update_one(
        {'_id': ObjectId(evaluation_row_id)},
        {'$set': {'vote': evaluation_row_dict["vote"]}}
    )
    if result.acknowledged:
        return evaluation_row_dict
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")


@router.get("/", response_model=List[ComparisonTable])
async def get_comparison_table_id():
    """lists the ids of all comparison tables

    Returns:
        _description_
    """
    cursor = comparison_tables.find().sort('created_at', -1)
    items = await cursor.to_list(length=100)    # limit length to 100 for the example
    for item in items:
        item['id'] = str(item['_id'])
    return items


@router.get("/{comparison_table_id}/results")
async def fetch_results(comparison_table_id: str):
    """Fetch all the results for one the comparison table

    Arguments:
        comparison_table_id -- _description_

    Returns:
        _description_
    """
    logging.debug("fetch_results")
    logging.debug(comparison_table_id)
    document = await comparison_tables.find_one({"_id": ObjectId(comparison_table_id)})

    results = {}
    logging.debug(document["variants"])

    count_flag = await evaluation_rows.count_documents({
        'vote': 'Flag',
        'comparison_table_id': comparison_table_id
    })
    results["flag"] = count_flag

    count_all_comparison_table_evaluation_rows = await evaluation_rows.count_documents({
        'comparison_table_id': comparison_table_id
    })
    results["nbOfRows"] = count_all_comparison_table_evaluation_rows

    for item in document["variants"]:
        count_variant: int = await evaluation_rows.count_documents({
            'vote': item,
            'comparison_table_id': comparison_table_id
        })
        results[item] = count_variant
    return {"results": results}
