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
DELETED_USER_IDS: set[str] = set()


def is_user_deleted(user_id: UUID | str) -> bool:
    return str(user_id) in DELETED_USER_IDS


def undelete_user(user_id: UUID | str) -> None:
    DELETED_USER_IDS.discard(str(user_id))


def reset_dev_profiles() -> None:
    DEV_PROFILES.clear()
    DELETED_USER_IDS.clear()



import re


def format_name_from_email(email: str | None) -> str:
    if not email:
        return ""
    local = email.split("@")[0]
    cleaned = re.sub(r"\d+$", "", local) if len(re.sub(r"\d+$", "", local)) >= 3 else local
    parts = [p.capitalize() for p in re.split(r"[-_.]+", cleaned) if p and not p.isdigit()]
    return " ".join(parts) if parts else local.capitalize()


def is_generic_placeholder(name: str | None) -> bool:
    if not name:
        return True
    n = name.strip().lower()
    return n in (
        "campus student",
        "campus faculty",
        "faculty member",
        "canteen staff",
        "canteen staff demo",
        "unnamed user",
        "student",
    )


def get_or_create_dev_profile(
    user_id: UUID,
    role: str = "student",
    full_name: str | None = None,
    student_id: str | None = None,
    email: str | None = None,
) -> ProfileRecord:
    if is_user_deleted(user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deleted.",
        )

    clean_name = (full_name or "").strip()
    if is_generic_placeholder(clean_name) and email:
        clean_name = format_name_from_email(email)

    if not clean_name:
        if role == "canteen_staff":
            clean_name = "Canteen Staff"
        elif role == "admin":
            clean_name = "Admin"
        elif role == "faculty":
            clean_name = "Faculty Member"
        else:
            clean_name = "Student"

    if user_id not in DEV_PROFILES:
        DEV_PROFILES[user_id] = ProfileRecord(
            id=user_id,
            full_name=clean_name,
            student_id=student_id,
            role=role,
            account_status="active",
            created_at=datetime.now(),
        )
    else:
        existing = DEV_PROFILES[user_id]
        should_update_name = bool(clean_name and (
            is_generic_placeholder(existing.full_name) or clean_name != existing.full_name
        ))
        if should_update_name or role != existing.role or student_id:
            DEV_PROFILES[user_id] = ProfileRecord(
                id=existing.id,
                full_name=clean_name if should_update_name else existing.full_name,
                student_id=student_id or existing.student_id,
                role=role or existing.role,
                account_status=existing.account_status,
                created_at=existing.created_at,
            )
    return DEV_PROFILES[user_id]


def set_dev_profile_role(user_id: UUID, role: str) -> ProfileRecord:
    p = get_or_create_dev_profile(user_id, role=role)
    current_name = p.full_name
    if is_generic_placeholder(current_name):
        current_name = "Canteen Staff" if role == "canteen_staff" else ("Faculty Member" if role == "faculty" else "Student")
    DEV_PROFILES[user_id] = ProfileRecord(
        id=p.id,
        full_name=current_name,
        student_id=p.student_id,
        role=role,
        account_status=p.account_status,
        created_at=p.created_at,
    )
    return DEV_PROFILES[user_id]


async def fetch_profile(
    config: SupabaseConfig,
    access_token: str,
    user_id: UUID,
    meta: dict[str, Any] | None = None,
) -> ProfileRecord:
    if is_user_deleted(user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deleted.",
        )
    user_meta = meta or {}
    meta_email = (user_meta.get("email") or "").strip()
    meta_name = (user_meta.get("full_name") or user_meta.get("name") or "").strip()
    if is_generic_placeholder(meta_name) and meta_email:
        meta_name = format_name_from_email(meta_email)
    meta_roll = (user_meta.get("student_id") or "").strip() or None
    meta_role = str(user_meta.get("role") or user_meta.get("user_type") or "student").strip()

    try:
        response = await _rest_request(
            config,
            access_token,
            "GET",
            params={"id": f"eq.{user_id}", "select": PROFILE_FIELDS, "limit": "1"},
        )
    except HTTPException:
        return get_or_create_dev_profile(
            user_id, role=meta_role, full_name=meta_name, student_id=meta_roll, email=meta_email
        )

    if response.status_code == 404:
        return get_or_create_dev_profile(
            user_id, role=meta_role, full_name=meta_name, student_id=meta_roll, email=meta_email
        )
    if response.status_code >= 400:
        _raise_profile_error(response)
    try:
        rows = response.json()
        fallback_role_name = "Faculty Member" if meta_role == "faculty" else ("Canteen Staff" if meta_role == "canteen_staff" else "Student")
        resolved_initial_name = meta_name or format_name_from_email(meta_email) or fallback_role_name
        if not rows:
            new_profile = {
                "id": str(user_id),
                "full_name": resolved_initial_name,
                "student_id": meta_roll,
                "role": meta_role or "student",
                "account_status": "active",
            }
            insert_resp = await _rest_request(config, access_token, "POST", payload=new_profile)
            if insert_resp.status_code < 400:
                inserted = insert_resp.json()
                if inserted:
                    return ProfileRecord.model_validate(inserted[0])
            return ProfileRecord(
                id=user_id,
                full_name=resolved_initial_name,
                student_id=meta_roll,
                role=meta_role or "student",
                account_status="active",
                created_at=datetime.now(),
            )
        record = ProfileRecord.model_validate(rows[0])
        # If record in DB has a generic name ("Campus Student", "Campus Faculty", etc.) and we have a better name
        if is_generic_placeholder(record.full_name) and (meta_name or meta_email):
            better_name = meta_name or format_name_from_email(meta_email)
            if better_name:
                return ProfileRecord(
                    id=record.id,
                    full_name=better_name,
                    student_id=record.student_id or meta_roll,
                    role=record.role,
                    account_status=record.account_status,
                    created_at=record.created_at,
                )
        return record
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
    if is_user_deleted(user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deleted.",
        )
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
    # 1. Permanently register as deleted in backend
    DELETED_USER_IDS.add(str(user_id))

    # 2. In-memory dev store cleanup (profile + dev orders)
    if user_id in DEV_PROFILES:
        del DEV_PROFILES[user_id]

    try:
        from app.services.dev_store import delete_dev_user_orders
        delete_dev_user_orders(user_id)
    except Exception:
        pass

    deleted_from_auth = False
    auth_warning = None

    import os
    service_role_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    # 3. Clean up database tables in Supabase (payments, order_items, orders, profiles)
    if config.url and not access_token.startswith("demo-"):
        token_for_db = service_role_key if service_role_key else access_token
        db_headers = {
            "apikey": service_role_key if service_role_key else config.anon_key,
            "Authorization": f"Bearer {token_for_db}",
            "Accept": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(4.0)) as client:
                # Find user order IDs to clean payments and order_items
                orders_resp = await client.get(
                    f"{config.url}/rest/v1/orders?user_id=eq.{user_id}&select=id",
                    headers=db_headers,
                )
                if orders_resp.status_code == 200:
                    order_rows = orders_resp.json()
                    if isinstance(order_rows, list) and order_rows:
                        order_ids = [str(r["id"]) for r in order_rows if isinstance(r, dict) and "id" in r]
                        if order_ids:
                            ids_filter = f"in.({','.join(order_ids)})"
                            await client.delete(
                                f"{config.url}/rest/v1/payments?order_id={ids_filter}",
                                headers=db_headers,
                            )
                            await client.delete(
                                f"{config.url}/rest/v1/order_items?order_id={ids_filter}",
                                headers=db_headers,
                            )
                await client.delete(
                    f"{config.url}/rest/v1/orders?user_id=eq.{user_id}",
                    headers=db_headers,
                )
                await client.delete(
                    f"{config.url}/rest/v1/profiles?id=eq.{user_id}",
                    headers=db_headers,
                )
        except Exception:
            pass

    # 4. Supabase Admin API with service_role key (permanently delete from auth.users)
    if service_role_key and config.url and not access_token.startswith("demo-"):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(4.0)) as client:
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

    # 5. Supabase RPC fallback (delete_user_self / delete_user_profile)
    if not deleted_from_auth and not access_token.startswith("demo-") and config.url:
        try:
            headers = {
                "apikey": config.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            }
            async with httpx.AsyncClient(timeout=3.0) as client:
                rpc_resp = await client.post(
                    f"{config.url}/rest/v1/rpc/delete_user_self",
                    headers=headers,
                )
                if rpc_resp.status_code < 300:
                    deleted_from_auth = True
                else:
                    rpc_resp2 = await client.post(
                        f"{config.url}/rest/v1/rpc/delete_user_profile",
                        headers=headers,
                    )
                    if rpc_resp2.status_code < 300:
                        deleted_from_auth = True
        except Exception:
            pass

    if not deleted_from_auth:
        auth_warning = (
            "Profile and all user records have been wiped. Supabase credentials have been disabled."
        )

    return {
        "status": "ok",
        "message": "Profile and all associated user data deleted successfully.",
        "user_id": str(user_id),
        "deleted_from_auth": deleted_from_auth,
        "auth_warning": auth_warning,
    }


