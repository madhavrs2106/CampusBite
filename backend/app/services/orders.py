from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException, status

from app.core.auth import SupabaseConfig


ORDER_SELECT = (
    "id,user_id,token_number,status,payment_method,payment_status,total_paise,"
    "created_at,updated_at,cancelled_at,decline_reason,"
    "order_items(id,menu_item_id,item_name,unit_price_paise,quantity,line_total_paise)"
)


async def _request(
    config: SupabaseConfig,
    access_token: str,
    path: str,
    *,
    method: str = "POST",
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
            return await client.request(
                method,
                f"{config.url}/rest/v1/{path}",
                params=params,
                json=payload,
                headers={
                    "apikey": config.anon_key,
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                    "Prefer": "return=representation",
                },
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The order service is temporarily unavailable.",
        ) from exc


def _raise_order_error(response: httpx.Response) -> None:
    try:
        error = response.json()
    except ValueError:
        error = {}
    error = error if isinstance(error, dict) else {}
    code = error.get("code")
    detail = {
        "42501": (403, "Order access was denied."),
        "P0002": (404, "Order not found."),
        "22023": (422, error.get("message", "The order request is invalid.")),
        "22003": (422, "The order total is too large."),
        "23514": (409, error.get("message", "The order conflicts with current canteen or order state.")),
        "23505": (409, "The request conflicts with an existing order."),
    }.get(code)
    if detail:
        raise HTTPException(status_code=detail[0], detail=detail[1])
    if response.status_code in (401, 403):
        raise HTTPException(status_code=response.status_code, detail="Order access was denied.")
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The order service could not complete the request.",
    )


def _normalise_order(record: dict[str, Any]) -> dict[str, Any]:
    if "items" not in record:
        record = {**record, "items": record.pop("order_items", [])}
    return record


async def create_order(
    config: SupabaseConfig,
    access_token: str,
    *,
    items: list[dict[str, Any]],
    payment_method: str,
    client_request_id: UUID,
) -> dict[str, Any]:
    response = await _request(
        config,
        access_token,
        "rpc/create_campus_order",
        payload={
            "p_items": items,
            "p_payment_method": payment_method,
            "p_client_request_id": str(client_request_id),
        },
    )
    if response.status_code >= 400:
        _raise_order_error(response)
    try:
        record = response.json()
        if not isinstance(record, dict):
            raise ValueError("Expected an order object")
        return _normalise_order(record)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The order service returned an invalid response.") from exc


async def list_orders(
    config: SupabaseConfig,
    access_token: str,
    *,
    user_id: UUID | None,
) -> list[dict[str, Any]]:
    params = {"select": ORDER_SELECT, "order": "created_at.desc", "limit": "100"}
    if user_id is not None:
        params["user_id"] = f"eq.{user_id}"
    response = await _request(config, access_token, "orders", method="GET", params=params)
    if response.status_code == 404:
        return []
    if response.status_code >= 400:
        _raise_order_error(response)
    try:
        rows = response.json()
        if not isinstance(rows, list):
            return []
        return [_normalise_order(row) for row in rows]
    except (ValueError, TypeError):
        return []


async def get_order(
    config: SupabaseConfig,
    access_token: str,
    order_id: UUID,
) -> dict[str, Any]:
    response = await _request(
        config,
        access_token,
        "orders",
        method="GET",
        params={"select": ORDER_SELECT, "id": f"eq.{order_id}", "limit": "1"},
    )
    if response.status_code >= 400:
        _raise_order_error(response)
    try:
        rows = response.json()
        if not rows:
            raise HTTPException(status_code=404, detail="Order not found.")
        return _normalise_order(rows[0])
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The order service returned invalid order data.") from exc


async def transition_order(
    config: SupabaseConfig,
    access_token: str,
    *,
    order_id: UUID,
    next_status: str,
    decline_reason: str | None,
) -> dict[str, Any]:
    response = await _request(
        config,
        access_token,
        "rpc/transition_campus_order",
        payload={
            "p_order_id": str(order_id),
            "p_next_status": next_status,
            "p_decline_reason": decline_reason,
        },
    )
    if response.status_code >= 400:
        _raise_order_error(response)
    try:
        record = response.json()
        if not isinstance(record, dict):
            raise ValueError("Expected an order object")
        return _normalise_order(record)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The order service returned an invalid response.") from exc
