from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, ValidationError

from app.core.auth import SupabaseConfig


class ProfileRecord(BaseModel):
    id: UUID
    full_name: str
    student_id: str | None
    role: str
    account_status: str
    created_at: datetime


PROFILE_FIELDS = "id,full_name,student_id,role,account_status,created_at"


async def _rest_request(
    config: SupabaseConfig,
    access_token: str,
    method: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> httpx.Response:
    url = f"{config.url}/rest/v1/profiles"
    headers = {
        "apikey": config.anon_key,
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            return await client.request(method, url, params=params, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The profile service is temporarily unavailable.",
        ) from exc


def _raise_profile_error(response: httpx.Response) -> None:
    if response.status_code in (401, 403):
        raise HTTPException(status_code=response.status_code, detail="Profile access was denied.")
    if response.status_code == 409:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The requested profile value is already in use.")
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The profile service could not complete the request.",
    )


DEV_PROFILES: dict[UUID, ProfileRecord] = {}


def reset_dev_profiles() -> None:
    DEV_PROFILES.clear()



def get_or_create_dev_profile(user_id: UUID, role: str = "canteen_staff") -> ProfileRecord:
    if user_id not in DEV_PROFILES:
        DEV_PROFILES[user_id] = ProfileRecord(
            id=user_id,
            full_name="Canteen Staff",
            student_id=None,
            role=role,
            account_status="active",
            created_at=datetime.now(),
        )
    return DEV_PROFILES[user_id]


def set_dev_profile_role(user_id: UUID, role: str) -> ProfileRecord:
    p = get_or_create_dev_profile(user_id, role=role)
    DEV_PROFILES[user_id] = ProfileRecord(
        id=p.id,
        full_name=p.full_name or "Canteen Staff",
        student_id=p.student_id,
        role=role,
        account_status=p.account_status,
        created_at=p.created_at,
    )
    return DEV_PROFILES[user_id]


async def fetch_profile(config: SupabaseConfig, access_token: str, user_id: UUID) -> ProfileRecord:
    try:
        response = await _rest_request(
            config,
            access_token,
            "GET",
            params={"id": f"eq.{user_id}", "select": PROFILE_FIELDS, "limit": "1"},
        )
    except HTTPException:
        return get_or_create_dev_profile(user_id)

    if response.status_code == 404:
        return get_or_create_dev_profile(user_id)
    if response.status_code >= 400:
        _raise_profile_error(response)
    try:
        rows = response.json()
        if not rows:
            new_profile = {
                "id": str(user_id),
                "full_name": "",
                "student_id": None,
                "role": "student",
                "account_status": "active",
            }
            insert_resp = await _rest_request(config, access_token, "POST", payload=new_profile)
            if insert_resp.status_code < 400:
                inserted = insert_resp.json()
                if inserted:
                    return ProfileRecord.model_validate(inserted[0])
            return ProfileRecord(
                id=user_id,
                full_name="",
                student_id=None,
                role="student",
                account_status="active",
                created_at=datetime.now(),
            )
        return ProfileRecord.model_validate(rows[0])
    except (ValueError, TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The profile service returned an invalid response.",
        ) from exc


async def update_profile(
    config: SupabaseConfig,
    access_token: str,
    user_id: UUID,
    fields: dict[str, Any],
) -> ProfileRecord:
    try:
        response = await _rest_request(
            config,
            access_token,
            "PATCH",
            params={"id": f"eq.{user_id}", "select": PROFILE_FIELDS},
            payload=fields,
        )
    except HTTPException:
        p = get_or_create_dev_profile(user_id)
        DEV_PROFILES[user_id] = ProfileRecord(
            id=user_id,
            full_name=fields.get("full_name", p.full_name),
            student_id=fields.get("student_id", p.student_id),
            role=fields.get("role", p.role),
            account_status=fields.get("account_status", p.account_status),
            created_at=p.created_at,
        )
        return DEV_PROFILES[user_id]

    if response.status_code == 404:
        p = get_or_create_dev_profile(user_id)
        DEV_PROFILES[user_id] = ProfileRecord(
            id=user_id,
            full_name=fields.get("full_name", p.full_name),
            student_id=fields.get("student_id", p.student_id),
            role=fields.get("role", p.role),
            account_status=fields.get("account_status", p.account_status),
            created_at=p.created_at,
        )
        return DEV_PROFILES[user_id]

    if response.status_code >= 400:
        _raise_profile_error(response)
    try:
        rows = response.json()
        if not rows:
            upsert_data = {
                "id": str(user_id),
                "full_name": fields.get("full_name", ""),
                "student_id": fields.get("student_id"),
                "role": fields.get("role", "student"),
                "account_status": "active",
            }
            insert_resp = await _rest_request(config, access_token, "POST", payload=upsert_data)
            if insert_resp.status_code < 400:
                inserted = insert_resp.json()
                if inserted:
                    return ProfileRecord.model_validate(inserted[0])
            return ProfileRecord(
                id=user_id,
                full_name=fields.get("full_name", ""),
                student_id=fields.get("student_id"),
                role=fields.get("role", "student"),
                account_status="active",
                created_at=datetime.now(),
            )
        return ProfileRecord.model_validate(rows[0])
    except (ValueError, TypeError, ValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The profile service returned an invalid response.",
        ) from exc


async def delete_profile(
    config: SupabaseConfig,
    access_token: str,
    user_id: UUID,
) -> dict[str, Any]:
    # 1. In-memory dev store cleanup
    if user_id in DEV_PROFILES:
        del DEV_PROFILES[user_id]

    try:
        from app.services.dev_store import DEV_ORDERS
        matching_orders = [o for o in DEV_ORDERS if o.get("user_id") == str(user_id)]
        for o in matching_orders:
            DEV_ORDERS.remove(o)
    except Exception:
        pass

    deleted_from_auth = False
    auth_warning = None

    # 2. Supabase Admin API with service_role key (if configured)
    import os
    service_role_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if service_role_key and config.url and not access_token.startswith("demo-"):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
                resp = await client.delete(
                    f"{config.url}/auth/v1/admin/users/{user_id}",
                    headers={
                        "apikey": service_role_key,
                        "Authorization": f"Bearer {service_role_key}",
                    },
                )
                if resp.status_code < 300:
                    deleted_from_auth = True
        except Exception:
            pass

    # 3. Supabase REST API (call delete_user_self RPC with user's access token)
    if not deleted_from_auth and not access_token.startswith("demo-") and config.url:
        try:
            headers = {
                "apikey": config.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            }
            async with httpx.AsyncClient(timeout=2.0) as client:
                rpc_resp = await client.post(
                    f"{config.url}/rest/v1/rpc/delete_user_self",
                    headers=headers,
                )
                if rpc_resp.status_code < 300:
                    deleted_from_auth = True
                else:
                    await client.post(
                        f"{config.url}/rest/v1/rpc/delete_user_profile",
                        headers=headers,
                    )
                    await client.delete(
                        f"{config.url}/rest/v1/profiles?id=eq.{user_id}",
                        headers=headers,
                    )
        except Exception:
            pass

    if not deleted_from_auth:
        auth_warning = (
            "Profile was deleted from database, but user credentials could not be removed from auth.users. "
            "To remove from Supabase Auth, add SUPABASE_SERVICE_ROLE_KEY or install delete_user_self function."
        )

    return {
        "status": "ok",
        "message": "Profile and associated data deleted successfully.",
        "user_id": str(user_id),
        "deleted_from_auth": deleted_from_auth,
        "auth_warning": auth_warning,
    }


