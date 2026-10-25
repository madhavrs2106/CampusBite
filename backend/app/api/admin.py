from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthContext, SupabaseConfig, get_current_user, get_supabase_config

router = APIRouter(prefix="/admin", tags=["admin"])

security_stealth = HTTPBearer(auto_error=False)


async def require_admin_stealth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_stealth),
) -> AuthContext:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    try:
        user = await get_current_user(credentials)
    except HTTPException:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return user


AdminUser = Annotated[AuthContext, Depends(require_admin_stealth)]


class AccountPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["student", "canteen_staff", "admin"]
    account_status: Literal["active", "pending", "suspended"]


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)


class CategoryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_active: bool | None = None


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    is_open: bool | None = None
    accepting_orders: bool | None = None


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
        raise HTTPException(status_code=503, detail="The administration service is temporarily unavailable.") from exc


def _check(response: httpx.Response) -> Any:
    if response.status_code >= 400:
        try:
            data = response.json()
        except ValueError:
            data = {}
        data = data if isinstance(data, dict) else {}
        code = data.get("code")
        mapping = {
            "42501": (403, "Administrator access was denied."),
            "23514": (409, data.get("message", "The requested change violates an account or business rule.")),
            "23505": (409, "A record with that name or value already exists."),
            "22023": (422, data.get("message", "The request is invalid.")),
            "P0002": (404, "The requested record was not found."),
        }
        if code in mapping:
            code_value, message = mapping[code]
            raise HTTPException(status_code=code_value, detail=message)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=response.status_code, detail="Administrator access was denied.")
        raise HTTPException(status_code=502, detail="The administration service could not complete the request.")
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="The administration service returned invalid data.") from exc


@router.get("/accounts")
async def list_accounts(
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
    query: str | None = Query(default=None, max_length=120),
    role: Literal["student", "canteen_staff", "admin"] | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    response = await _request(
        config,
        user,
        "rpc/admin_list_accounts",
        method="POST",
        payload={"p_query": query, "p_role": role, "p_limit": limit, "p_offset": offset},
    )
    rows = _check(response)
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="The account service returned invalid data.")
    return rows


@router.patch("/accounts/{user_id}")
async def update_account(
    user_id: UUID,
    body: AccountPatch,
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    response = await _request(
        config,
        user,
        "rpc/admin_update_profile",
        method="POST",
        payload={"p_target_user_id": str(user_id), "p_new_role": body.role, "p_new_status": body.account_status},
    )
    result = _check(response)
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="The account service returned invalid data.")
    return result


@router.delete("/accounts/{user_id}")
async def delete_account(
    user_id: UUID,
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    from app.services.profiles import delete_profile
    return await delete_profile(config, user.access_token, user_id)


@router.get("/categories")
async def admin_categories(
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict[str, Any]]:
    return _check(await _request(
        config,
        user,
        "categories",
        params={"select": "id,name,is_active,created_at,updated_at", "order": "name.asc"},
    ))


@router.post("/categories", status_code=201)
async def create_category(
    body: CategoryCreate,
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Category name cannot be blank.")
    response = await _request(config, user, "categories", method="POST", payload={"name": body.name.strip()})
    rows = _check(response)
    if not rows:
        raise HTTPException(status_code=502, detail="The new category was not returned.")
    return rows[0]


@router.patch("/categories/{category_id}")
async def update_category(
    category_id: UUID,
    body: CategoryPatch,
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=422, detail="Provide at least one category field to update.")
    if any(value is None and key != "name" for key, value in payload.items()):
        raise HTTPException(status_code=422, detail="Category fields cannot be null.")
    if "name" in payload:
        payload["name"] = payload["name"].strip() if payload["name"] is not None else None
        if not payload["name"]:
            raise HTTPException(status_code=422, detail="Category name cannot be blank.")
    response = await _request(config, user, "categories", method="PATCH", params={"id": f"eq.{category_id}", "select": "id,name,is_active,created_at,updated_at"}, payload=payload)
    rows = _check(response)
    if not rows:
        raise HTTPException(status_code=404, detail="Category not found.")
    return rows[0]


@router.get("/reports/daily")
async def daily_report(
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
    start_date: date = Query(default_factory=lambda: datetime.now(UTC).date()),
    end_date: date = Query(default_factory=lambda: datetime.now(UTC).date()),
) -> dict[str, Any]:
    result = _check(await _request(
        config,
        user,
        "rpc/admin_daily_report",
        method="POST",
        payload={"p_start_date": start_date.isoformat(), "p_end_date": end_date.isoformat()},
    ))
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="The reports service returned invalid data.")
    return result


@router.get("/settings")
async def get_settings(
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    rows = _check(await _request(config, user, "canteen_settings", params={"select": "display_name,is_open,accepting_orders,updated_at", "id": "eq.true", "limit": "1"}))
    if not rows:
        raise HTTPException(status_code=404, detail="Canteen settings were not found.")
    return rows[0]


@router.patch("/settings")
async def update_settings(
    body: SettingsPatch,
    user: AdminUser,
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict[str, Any]:
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=422, detail="Provide at least one setting to update.")
    if any(value is None for value in payload.values()):
        raise HTTPException(status_code=422, detail="Settings cannot be set to null.")
    if "display_name" in payload:
        payload["display_name"] = payload["display_name"].strip() if payload["display_name"] is not None else None
        if not payload["display_name"]:
            raise HTTPException(status_code=422, detail="Canteen name cannot be blank.")
    rows = _check(await _request(config, user, "canteen_settings", method="PATCH", params={"id": "eq.true", "select": "display_name,is_open,accepting_orders,updated_at"}, payload=payload))
    if not rows:
        raise HTTPException(status_code=404, detail="Canteen settings were not found.")
    return rows[0]
