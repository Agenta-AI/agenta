from sqlalchemy import Select, and_, or_

from oss.src.core.shared.dtos import Windowing


def apply_windowing(
    *,
    stmt: Select,
    DBE,
    attribute: str,
    order: str,
    windowing: Windowing,
) -> Select:
    # ---------------------------------------------------------------- #
    entity_id_attribute = DBE.id if getattr(DBE, "id", None) else None  # type: ignore
    span_id_attribute = DBE.span_id if getattr(DBE, "span_id", None) else None  # type: ignore
    id_attribute = span_id_attribute or entity_id_attribute or None
    created_at_attribute = DBE.created_at if getattr(DBE, "created_at", None) else None  # type: ignore
    start_time_attribute = DBE.start_time if getattr(DBE, "start_time", None) else None  # type: ignore
    time_attribute = start_time_attribute or created_at_attribute or None
    # UUID7 -> id ---------------------------------------------------- #
    order_attribute = {
        "id": id_attribute,
        "span_id": span_id_attribute,
        "created_at": created_at_attribute,
        "start_time": start_time_attribute,
    }.get(attribute.lower(), created_at_attribute)

    if not order_attribute or not time_attribute or not id_attribute:
        return stmt
    # ---------------------------------------------------------------- #
    ascending_order = order_attribute.asc()  # type: ignore
    descending_order = order_attribute.desc()  # type: ignore
    # time-style -> descending --------------------------------------- #
    if order.lower() == "descending":
        windowing_order = descending_order
    elif order.lower() == "ascending":
        windowing_order = ascending_order
    else:
        windowing_order = ascending_order

    # ---------------------------------------------------------------- #

    if windowing.order:
        if windowing.order.lower() == "descending":
            windowing_order = descending_order
        elif windowing.order.lower() == "ascending":
            windowing_order = ascending_order

    if windowing_order == ascending_order:
        if windowing.newest:
            stmt = stmt.filter(time_attribute <= windowing.newest)
        if windowing.oldest:
            if windowing.next:
                stmt = stmt.filter(time_attribute >= windowing.oldest)
            else:
                stmt = stmt.filter(time_attribute > windowing.oldest)
        if windowing.next:
            if order_attribute is id_attribute:  # UUID7 case
                stmt = stmt.filter(id_attribute > windowing.next)
            elif windowing.oldest:  # time-based order: use .oldest + .next
                stmt = stmt.filter(
                    or_(
                        time_attribute > windowing.oldest,
                        and_(
                            time_attribute == windowing.oldest,
                            id_attribute > windowing.next,
                        ),
                    )
                )
    else:
        if windowing.newest:
            if windowing.next:
                stmt = stmt.filter(time_attribute <= windowing.newest)
            else:
                stmt = stmt.filter(time_attribute < windowing.newest)
        if windowing.oldest:
            stmt = stmt.filter(time_attribute >= windowing.oldest)
        if windowing.next:
            if order_attribute is id_attribute:  # UUID7 case
                stmt = stmt.filter(id_attribute < windowing.next)
            elif windowing.newest:  # time-based order: use .newest + .next
                stmt = stmt.filter(
                    or_(
                        time_attribute < windowing.newest,
                        and_(
                            time_attribute == windowing.newest,
                            id_attribute < windowing.next,
                        ),
                    )
                )

    if order_attribute is id_attribute:
        stmt = stmt.order_by(windowing_order)
    else:
        stmt = stmt.order_by(windowing_order, id_attribute)

    if windowing.limit:
        stmt = stmt.limit(windowing.limit)

    return stmt
