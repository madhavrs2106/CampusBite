from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthContext, SupabaseConfig, get_current_user, get_supabase_config
from app.services.profiles import ProfileRecord, update_profile

router = APIRouter(tags=["profile"])


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=120)
    student_id: str | None = Field(default=None, max_length=50)


def _profile_response(user: AuthContext) -> ProfileRecord:
    return ProfileRecord(
        id=user.user_id,
        full_name=user.full_name,
        student_id=user.student_id,
        role=user.role,
        account_status=user.account_status,
        created_at=user.created_at,
    )


@router.get("/me", response_model=ProfileRecord)
async def get_me(
    user: Annotated[AuthContext, Depends(get_current_user)],
) -> ProfileRecord:
    return _profile_response(user)


@router.get("/me/profile", response_model=ProfileRecord)
async def get_my_profile(
    user: Annotated[AuthContext, Depends(get_current_user)],
) -> ProfileRecord:
    return _profile_response(user)


@router.patch("/me/profile", response_model=ProfileRecord)
async def patch_my_profile(
    body: ProfilePatch,
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> ProfileRecord:
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Provide at least one profile field.")
    if "full_name" in fields and body.full_name is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="full_name cannot be null.")

    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if isinstance(value, str):
            value = value.strip()
            if key == "full_name" and not value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="full_name cannot be blank.")
            changes[key] = value or (None if key == "student_id" else value)

    return await update_profile(config, user.access_token, user.user_id, changes)


class RoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str = Field(pattern="^(student|faculty|canteen_staff|admin)$")



@router.post("/me/role", response_model=ProfileRecord)
async def update_my_role(
    body: RoleUpdate,
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> ProfileRecord:
    from app.services.profiles import set_dev_profile_role
    try:
        return await update_profile(config, user.access_token, user.user_id, {"role": body.role})
    except HTTPException:
        return set_dev_profile_role(user.user_id, body.role)


@router.delete("/me/profile", status_code=status.HTTP_200_OK)
@router.delete("/me", status_code=status.HTTP_200_OK)
async def delete_my_profile(
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict:
    from app.services.profiles import delete_profile
    return await delete_profile(config, user.access_token, user.user_id)


class CleanupUserRequest(BaseModel):
    email: str


@router.post("/auth/cleanup-user")
async def cleanup_deleted_user(body: CleanupUserRequest) -> dict[str, Any]:
    import os
    import httpx
    from app.services.profiles import undelete_user

    email = body.email.strip().lower()
    service_role_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    if not service_role_key or not supabase_url:
        return {"cleaned": False, "reason": "No SUPABASE_SERVICE_ROLE_KEY configured"}

    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(6.0)) as client:
            resp = await client.get(f"{supabase_url}/auth/v1/admin/users", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                users = data.get("users", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                for u in users:
                    if u.get("email", "").lower() == email:
                        uid = u.get("id")
                        del_resp = await client.delete(f"{supabase_url}/auth/v1/admin/users/{uid}", headers=headers)
                        if del_resp.status_code < 300:
                            undelete_user(uid)
                            return {"cleaned": True, "user_id": uid}
    except Exception as exc:
        return {"cleaned": False, "error": str(exc)}

    return {"cleaned": False, "reason": "User not found or already deleted"}


@router.post("/me/reactivate", status_code=status.HTTP_200_OK)
async def reactivate_my_profile(
    user: Annotated[AuthContext, Depends(get_current_user)],
) -> dict[str, str]:
    from app.services.profiles import undelete_user
    undelete_user(user.user_id)
    return {"status": "ok", "message": "Account reactivated successfully."}

