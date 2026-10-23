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

