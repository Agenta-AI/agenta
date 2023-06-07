from fastapi import HTTPException, APIRouter, Body
from agenta_backend.models.api.app_evaluation_model import ComparisonTable, EvaluationRow, EvaluationRowUpdate, NewComparisonTable, DeleteComparisonTable
from agenta_backend.services.db_mongo import comparison_tables, evaluation_rows, datasets
from datetime import datetime
from bson import ObjectId
from typing import List
import logging
router = APIRouter()


@router.post("/", response_model=ComparisonTable)
async def create_comparison_table(newComparisonTableData: NewComparisonTable = Body(...)):
    """Creates a new comparison table document

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    comparison_table = newComparisonTableData.dict()
    comparison_table["created_at"] = comparison_table["updated_at"] = datetime.utcnow()

    newComparisonTable = await comparison_tables.insert_one(comparison_table)

    if newComparisonTable.acknowledged:
        datasetId = comparison_table["dataset"]["_id"]
        dataset = await datasets.find_one({"_id": ObjectId(datasetId)})
        csvdata = dataset["csvdata"]
        for datum in csvdata:
            evaluation_row = {
                "comparison_table_id": str(newComparisonTable.inserted_id),
                "inputs": [{'input_name': name, 'input_value': datum[name]} for name in comparison_table["inputs"]],
                "outputs": [],
                "vote": "",
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
            await evaluation_rows.insert_one(evaluation_row)

        comparison_table["id"] = str(newComparisonTable.inserted_id)
        return comparison_table
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")

@router.get("/{comparison_table_id}/evaluation_rows", response_model=List[EvaluationRow])
async def fetch_evaluation_rows(comparison_table_id: str):
    """Creates an empty evaluation row

    Arguments:
        evaluation_row -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    cursor = evaluation_rows.find({"comparison_table_id": comparison_table_id})
    items = await cursor.to_list(length=100)    # limit length to 100 for the example
    for item in items:
        item['id'] = str(item['_id'])
    return items

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
        {'$set': {
            'vote': evaluation_row_dict["vote"],
            'outputs': evaluation_row_dict["outputs"]
        }}
    )
    if result.acknowledged:
        return evaluation_row_dict
    else:
        raise HTTPException(status_code=500, detail="Failed to create evaluation_row")


@router.get("/", response_model=List[ComparisonTable])
async def fetch_list_comparison_tables():
    """lists of all comparison tables

    Returns:
        _description_
    """
    cursor = comparison_tables.find().sort('created_at', -1)
    items = await cursor.to_list(length=100)    # limit length to 100 for the example
    for item in items:
        item['id'] = str(item['_id'])
    return items


@router.get("/{comparison_table_id}", response_model=ComparisonTable)
async def fetch_comparison_table(comparison_table_id: str):
    """Fetch one comparison table

    Returns:
        _description_
    """
    comparison_table = await comparison_tables.find_one({"_id" : ObjectId(comparison_table_id)})
    if comparison_table:
        comparison_table["id"] = str(comparison_table["_id"])
        return comparison_table
    else:
        raise HTTPException(status_code=404, detail=f"dataset with id {comparison_table_id} not found")

@router.delete("/", response_model=List[str])
async def delete_comparison_tables(delete_comparison_tables: DeleteComparisonTable):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_comparison_tables (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """
    deleted_ids = []

    for comparison_tables_id in delete_comparison_tables.comparison_tables_ids:
        app_evaluation = await comparison_tables.find_one({'_id': ObjectId(comparison_tables_id)})

        if app_evaluation is not None:
            result = await comparison_tables.delete_one({'_id': ObjectId(comparison_tables_id)})
            if result:
                deleted_ids.append(comparison_tables_id)
        else:
            raise HTTPException(status_code=404, detail=f"Comparison table {comparison_tables_id} not found")

    return deleted_ids

@router.get("/{comparison_table_id}/votes_data")
async def fetch_results(comparison_table_id: str):
    """Fetch all the results for one the comparison table

    Arguments:
        comparison_table_id -- _description_

    Returns:
        _description_
    """
    document = await comparison_tables.find_one({"_id": ObjectId(comparison_table_id)})
    results = {}

    variants = document.get("variants", [])
    results["variants"] = variants
    results["variants_votes_data"] = {}

    comparison_table_rows_nb = await evaluation_rows.count_documents({
        'comparison_table_id': comparison_table_id
    })
    results["nb_of_rows"] = comparison_table_rows_nb

    flag_votes_nb = await evaluation_rows.count_documents({
        'vote': '0',
        'comparison_table_id': comparison_table_id
    })
    results["flag_votes"] = {}
    results["flag_votes"]["number_of_votes"] = flag_votes_nb
    results["flag_votes"]["percentage"] = round(flag_votes_nb / comparison_table_rows_nb * 100, 2)

    for item in variants:
        results["variants_votes_data"][item] = {}
        variant_votes_nb: int = await evaluation_rows.count_documents({
            'vote': item,
            'comparison_table_id': comparison_table_id
        })
        results["variants_votes_data"][item]["number_of_votes"]= variant_votes_nb
        results["variants_votes_data"][item]["percentage"] = round(variant_votes_nb / comparison_table_rows_nb * 100, 2)
    return {"votes_data": results}
