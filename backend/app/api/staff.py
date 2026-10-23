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


@router.get("/menu")
async def staff_menu(
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict[str, Any]]:
    response = await _request(
        config,
        user,
        "menu_items",
        params={"select": MenuSelect, "order": "name.asc", "limit": "500"},
    )
    return _check(response)


@router.get("/categories")
async def staff_categories(
    user: StaffUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict[str, Any]]:
    response = await _request(
        config,
        user,
        "categories",
        params={"select": "id,name,is_active", "order": "name.asc"},
    )
    return _check(response)


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

    response = await _request(config, user, "menu_items", method="POST", payload=payload)
    records = _check(response)
    if not records:
        raise HTTPException(status_code=502, detail="The new menu item was not returned.")
    return records[0]


@router.patch("/menu/{item_id}")
async def update_menu_item(
    item_id: UUID,
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

    # Fetch existing item to check current state
    existing_resp = await _request(
        config,
        user,
        "menu_items",
        params={"id": f"eq.{item_id}", "select": MenuSelect, "limit": "1"},
    )
    existing_records = _check(existing_resp)
    if not existing_records:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    existing = existing_records[0]

    # If recipe, name, or description changes, require reverification
    recipe_changed = False
    if "name" in payload:
        payload["name"] = payload["name"].strip() if payload["name"] is not None else None
        if not payload["name"]:
            raise HTTPException(status_code=422, detail="Menu item name cannot be blank.")
        if payload["name"] != existing.get("name"):
            recipe_changed = True

    if "description" in payload and payload["description"] is not None:
        payload["description"] = payload["description"].strip()
        if payload["description"] != existing.get("description"):
            recipe_changed = True

    # When recipe changes, reset verification unless explicitly re-verified in the same request
    if recipe_changed and payload.get("ingredients_verified") is not True:
        payload["ingredients_verified"] = False
        if payload.get("is_available") is True or (payload.get("is_available") is None and existing.get("is_available")):
            raise HTTPException(
                status_code=422,
                detail="Recipe changed. Ingredients must be reverified before the item can be published or remain available.",
            )
        payload["is_available"] = False

    # Check availability: cannot be available if unverified
    new_is_available = payload.get("is_available", existing.get("is_available"))
    new_verified = payload.get("ingredients_verified", existing.get("ingredients_verified"))
    if new_is_available and not new_verified:
        raise HTTPException(
            status_code=422,
            detail="Cannot make item available until ingredients are verified by staff.",
        )

    response = await _request(
        config,
        user,
        "menu_items",
        method="PATCH",
        params={"id": f"eq.{item_id}", "select": MenuSelect},
        payload=payload,
    )
    records = _check(response)
    if not records:
        raise HTTPException(status_code=404, detail="Menu item not found.")
    return records[0]
