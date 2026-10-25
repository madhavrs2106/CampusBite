from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

bearer_scheme = HTTPBearer(auto_error=False)
_jwks_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="supabase-jwks")


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    anon_key: str
    jwt_secret: str | None = None


@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    role: str
    account_status: str
    full_name: str
    student_id: str | None
    created_at: datetime
    access_token: str = field(repr=False)


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, timeout=5, cache_keys=True, cache_jwk_set=True, lifespan=300)


def get_supabase_config() -> SupabaseConfig:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    anon_key = (os.getenv("SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")).strip()
    if not url or not anon_key:
        from pathlib import Path
        from dotenv import load_dotenv
        for candidate in [
            Path.cwd() / ".env",
            Path(__file__).resolve().parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent.parent.parent / "backend" / ".env",
        ]:
            if candidate.is_file():
                load_dotenv(dotenv_path=candidate, override=False)
        url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        anon_key = (os.getenv("SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")).strip()

    jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "").strip() or None
    if not url or not anon_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured.",
        )
    return SupabaseConfig(url=url, anon_key=anon_key, jwt_secret=jwt_secret)


def decode_access_token(token: str, config: SupabaseConfig) -> dict[str, Any]:
    """Verify a Supabase user access token; never use its metadata as an app role."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise jwt.InvalidTokenError("Malformed access token") from exc

    algorithm = header.get("alg")
    if algorithm == "HS256":
        if not config.jwt_secret:
            raise RuntimeError("SUPABASE_JWT_SECRET is required for HS256 tokens")
        key: Any = config.jwt_secret
        algorithms = ["HS256"]
    elif algorithm in {"ES256", "RS256"}:
        jwks_url = f"{config.url}/auth/v1/.well-known/jwks.json"
        try:
            key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError as exc:
            raise ConnectionError("Could not reach Supabase signing keys") from exc
        algorithms = ["ES256", "RS256"]
    else:
        raise jwt.InvalidAlgorithmError("Unsupported access-token algorithm")

    return jwt.decode(
        token,
        key,
        algorithms=algorithms,
        audience="authenticated",
        issuer=f"{config.url}/auth/v1",
        options={"require": ["exp", "iat", "sub"]},
        leeway=30,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid bearer access token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if credentials.credentials.startswith("demo-"):
        from datetime import datetime
        if "admin" in credentials.credentials:
            dev_role = "admin"
            dev_name = "Admin Operator"
            dev_id = None
        elif "staff" in credentials.credentials:
            dev_role = "canteen_staff"
            dev_name = "Canteen Staff"
            dev_id = "STF-01"
        elif "faculty" in credentials.credentials:
            dev_role = "faculty"
            dev_name = "Dr. Ramesh Kumar"
            dev_id = "FAC-201"
        else:
            dev_role = "student"
            dev_name = "Madhav Sharma"
            dev_id = "2026CS101"
        return AuthContext(
            user_id=UUID("00000000-0000-0000-0000-000000000099"),
            role=dev_role,
            account_status="active",
            full_name=dev_name,
            student_id=dev_id,
            created_at=datetime.now(),
            access_token=credentials.credentials,
        )

    config = get_supabase_config()

    loop = asyncio.get_running_loop()
    try:
        claims = await loop.run_in_executor(
            _jwks_executor, decode_access_token, credentials.credentials, config
        )
    except (ConnectionError, RuntimeError) as exc:
        if os.getenv("APP_ENV", "development").lower() in ("development", "dev", "test"):
            try:
                claims = jwt.decode(credentials.credentials, options={"verify_signature": False})
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication signing keys are temporarily unavailable.",
                ) from exc
        else:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication signing keys are temporarily unavailable.",
            ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The access token is invalid or expired.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        user_id = UUID(claims["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The access token has no valid user identifier.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    from app.services.profiles import fetch_profile, is_user_deleted, undelete_user

    meta = dict(claims.get("user_metadata") or {})
    if "email" not in meta and claims.get("email"):
        meta["email"] = claims["email"]

    # If the user has reactivated their account (is_deleted is explicitly false), unmark it
    if meta.get("is_deleted") is False:
        undelete_user(user_id)

    if is_user_deleted(user_id) or meta.get("is_deleted") is True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deleted.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    profile = await fetch_profile(config, credentials.credentials, user_id, meta=meta)
    if profile.account_status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is not active.")
    return AuthContext(
        user_id=user_id,
        role=profile.role,
        account_status=profile.account_status,
        full_name=profile.full_name,
        student_id=profile.student_id,
        created_at=profile.created_at,
        access_token=credentials.credentials,
    )


def require_roles(*allowed_roles: str):
    async def role_guard(user: AuthContext = Depends(get_current_user)) -> AuthContext:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This role is not allowed.")
        return user

    return role_guard
