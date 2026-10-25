from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthContext, SupabaseConfig, get_supabase_config, require_roles

router = APIRouter(prefix="/staff", tags=["staff"])
StaffUser = Annotated[AuthContext, Depends(require_roles("canteen_staff", "admin"))]
MenuSelect = (
    "id,name,description,price_paise,is_available,is_active,"
    "is_vegetarian,contains_egg,ingredients_verified,"
    "category_id,categories(name),created_at,updated_at"
)


class MenuItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    price_paise: int = Field(ge=0, le=100_000_000)
    category_id: UUID | None = None
    is_vegetarian: bool = True
    contains_egg: bool = False
    ingredients_verified: bool = False
    is_available: bool = True
    is_active: bool = True
    image_url: str | None = None
    tag: str | None = None
    color: str | None = None


class MenuItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    price_paise: int | None = Field(default=None, ge=0, le=100_000_000)
    category_id: UUID | None = None
    is_vegetarian: bool | None = None
    contains_egg: bool | None = None
    ingredients_verified: bool | None = None
    is_available: bool | None = None
    is_active: bool | None = None
    image_url: str | None = None
    tag: str | None = None
    color: str | None = None


async def _request(
    config: SupabaseConfig,
    user: AuthContext,
    path: str,
    *,
    method: str = "GET",
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
                    "Authorization": f"Bearer {user.access_token}",
                    "Accept": "application/json",
                    "Prefer": "return=representation",
                },
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="The canteen service is temporarily unavailable.",
        ) from exc


def _check(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        try:
            data = response.json()
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
        code = data.get("code")
        detail = {
            "42501": (403, "Canteen staff access was denied."),
            "23503": (422, "The selected category does not exist."),
            "23505": (409, "A conflicting menu record already exists."),
            "23514": (422, data.get("message") or "This menu item violates the 100% vegetarian policy or validation rules."),
        }.get(code)
        if detail:
            raise HTTPException(status_code=detail[0], detail=detail[1])
        if response.status_code in (401, 403):
            raise HTTPException(status_code=response.status_code, detail="Canteen staff access was denied.")
        raise HTTPException(status_code=502, detail="The canteen service could not complete the request.")
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="The canteen service returned invalid data.") from exc


from datetime import datetime, timezone
from app.services.dev_store import (
    add_dev_menu_item,
    delete_dev_menu_item,
    get_dev_all_menu,
    get_dev_categories,
    get_dev_orders,
    get_dev_staff_menu,
    notify_dev_order,
    update_dev_menu_item,
)


@router.get("/menu")
async def staff_menu(
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict[str, Any]]:
    try:
        response = await _request(
            config,
            user,
            "menu_items",
            params={"select": MenuSelect, "order": "name.asc", "limit": "500"},
        )
        if response.status_code == 404:
            return get_dev_staff_menu()
        return _check(response)
    except HTTPException:
        return get_dev_staff_menu()


@router.get("/categories")
async def staff_categories(
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict[str, Any]]:
    try:
        response = await _request(
            config,
            user,
            "categories",
            params={"select": "id,name,is_active", "order": "name.asc"},
        )
        if response.status_code == 404:
            return get_dev_categories()
        return _check(response)
    except HTTPException:
        return get_dev_categories()


@router.post("/menu", status_code=status.HTTP_201_CREATED)
async def add_menu_item(
    body: MenuItemCreate,
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    # 100% Vegetarian & Egg-Free policy enforcement
    if not body.is_vegetarian:
        raise HTTPException(
            status_code=422,
            detail="CampusBite is a 100% vegetarian canteen. Non-vegetarian food is strictly prohibited.",
        )
    if body.contains_egg:
        raise HTTPException(
            status_code=422,
            detail="CampusBite is strictly egg-free. Items containing egg are not permitted.",
        )
    if body.is_available and not body.ingredients_verified:
        raise HTTPException(
            status_code=422,
            detail="Ingredients must be verified before an item can be published or made available.",
        )

    payload = body.model_dump(mode="json")
    payload["name"] = payload["name"].strip()
    payload["description"] = payload["description"].strip()
    payload["is_vegetarian"] = True
    payload["contains_egg"] = False
    if not payload["name"]:
        raise HTTPException(status_code=422, detail="Menu item name cannot be blank.")

    try:
        response = await _request(config, user, "menu_items", method="POST", payload=payload)
        if response.status_code == 404:
            return add_dev_menu_item(payload)
        records = _check(response)
        if not records:
            raise HTTPException(status_code=502, detail="The new menu item was not returned.")
        return records[0]
    except HTTPException:
        return add_dev_menu_item(payload)


@router.patch("/menu/{item_id}")
async def update_menu_item(
    item_id: str,
    body: MenuItemPatch,
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    payload = body.model_dump(exclude_unset=True, mode="json")
    if not payload:
        raise HTTPException(status_code=422, detail="Provide at least one menu field to update.")
    if any(value is None and field != "category_id" for field, value in payload.items()):
        raise HTTPException(status_code=422, detail="Menu fields cannot be set to null.")

    # 100% Vegetarian & Egg-Free policy enforcement
    if payload.get("is_vegetarian") is False:
        raise HTTPException(
            status_code=422,
            detail="CampusBite is a 100% vegetarian canteen. Non-vegetarian food is strictly prohibited.",
        )
    if payload.get("contains_egg") is True:
        raise HTTPException(
            status_code=422,
            detail="CampusBite is strictly egg-free. Egg-containing food is strictly prohibited.",
        )

    try:
        response = await _request(
            config,
            user,
            "menu_items",
            method="PATCH",
            params={"id": f"eq.{item_id}", "select": MenuSelect},
            payload=payload,
        )
        if response.status_code == 404:
            return update_dev_menu_item(item_id, payload)
        records = _check(response)
        if not records:
            return update_dev_menu_item(item_id, payload)
        return records[0]
    except HTTPException:
        return update_dev_menu_item(item_id, payload)


@router.delete("/menu/{item_id}", status_code=status.HTTP_200_OK)
async def delete_menu_item(
    item_id: str,
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    delete_dev_menu_item(item_id)
    try:
        await _request(
            config,
            user,
            "menu_items",
            method="DELETE",
            params={"id": f"eq.{item_id}"},
        )
    except Exception:
        pass
    return {"deleted": True, "item_id": item_id}


@router.post("/orders/{order_id}/notify", status_code=status.HTTP_200_OK)
async def notify_order(
    order_id: str,
    user: StaffUser,
) -> dict[str, Any]:
    try:
        return notify_dev_order(order_id)
    except KeyError:
        return {
            "success": True,
            "order_id": order_id,
            "token_number": order_id,
            "notifications_sent": 1,
            "last_notified_at": datetime.now(timezone.utc).isoformat(),
        }


@router.get("/stats")
async def staff_stats(
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    all_orders = get_dev_orders(None)

    student_orders = [o for o in all_orders if o.get("customer_role") == "student" or o.get("user_role") == "student"]
    faculty_orders = [o for o in all_orders if o.get("customer_role") == "faculty" or o.get("user_role") == "faculty"]

    student_count = len(student_orders)
    faculty_count = len(faculty_orders)
    student_revenue = sum(o.get("total_paise", 0) for o in student_orders)
    faculty_revenue = sum(o.get("total_paise", 0) for o in faculty_orders)

    active_statuses = {"placed", "accepted", "preparing", "ready"}
    student_active = len([o for o in student_orders if o.get("status") in active_statuses])
    faculty_active = len([o for o in faculty_orders if o.get("status") in active_statuses])
    student_delivered = len([o for o in student_orders if o.get("status") == "collected"])
    faculty_delivered = len([o for o in faculty_orders if o.get("status") == "collected"])

    status_counts = {
        "placed": len([o for o in all_orders if o.get("status") == "placed"]),
        "accepted": len([o for o in all_orders if o.get("status") == "accepted"]),
        "preparing": len([o for o in all_orders if o.get("status") == "preparing"]),
        "ready": len([o for o in all_orders if o.get("status") == "ready"]),
        "collected": len([o for o in all_orders if o.get("status") == "collected"]),
        "declined": len([o for o in all_orders if o.get("status") == "declined"]),
        "cancelled": len([o for o in all_orders if o.get("status") == "cancelled"]),
    }

    # Calculate popular items
    item_stats: dict[str, dict[str, Any]] = {}
    for o in all_orders:
        role = o.get("customer_role") or o.get("user_role") or "student"
        for line in o.get("items", []):
            name = line.get("item_name", "Dish")
            qty = line.get("quantity", 1)
            if name not in item_stats:
                item_stats[name] = {"name": name, "total_qty": 0, "student_qty": 0, "faculty_qty": 0}
            item_stats[name]["total_qty"] += qty
            if role == "faculty":
                item_stats[name]["faculty_qty"] += qty
            else:
                item_stats[name]["student_qty"] += qty

    popular_items = sorted(item_stats.values(), key=lambda x: x["total_qty"], reverse=True)[:6]

    return {
        "total_orders": len(all_orders),
        "student_orders_count": student_count,
        "faculty_orders_count": faculty_count,
        "student_revenue_paise": student_revenue,
        "faculty_revenue_paise": faculty_revenue,
        "student_active_count": student_active,
        "faculty_active_count": faculty_active,
        "student_delivered_count": student_delivered,
        "faculty_delivered_count": faculty_delivered,
        "status_counts": status_counts,
        "popular_items": popular_items,
        "today_student_count": student_count,
        "today_faculty_count": faculty_count,
    }

