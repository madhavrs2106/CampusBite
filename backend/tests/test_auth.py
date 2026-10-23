from __future__ import annotations

import asyncio
import os
import unittest
from datetime import UTC, datetime, timedelta
from uuid import UUID
from unittest.mock import AsyncMock, patch

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import AuthContext, SupabaseConfig, decode_access_token, get_current_user, require_roles
from app.main import app
from app.services.profiles import ProfileRecord

TEST_URL = "https://campusbite-test.supabase.co"
TEST_SECRET = "test-only-secret-that-is-not-used-outside-unit-tests"
TEST_USER_ID = UUID("8607d5e0-7ac5-48dc-9106-2f2f39ec78cd")


def make_token(*, issuer: str = f"{TEST_URL}/auth/v1", audience: str = "authenticated", expires: int = 120) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(TEST_USER_ID),
            "aud": audience,
            "iss": issuer,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=expires)).timestamp()),
            "app_metadata": {"role": "admin"},
        },
        TEST_SECRET,
        algorithm="HS256",
    )


class AccessTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = SupabaseConfig(TEST_URL, "test-anon-key", TEST_SECRET)

    def test_accepts_valid_supabase_token_without_trusting_metadata_role(self) -> None:
        claims = decode_access_token(make_token(), self.config)
        self.assertEqual(claims["sub"], str(TEST_USER_ID))
        # Supabase metadata is deliberately not used to derive the CampusBite role.
        self.assertEqual(claims["app_metadata"]["role"], "admin")

    def test_rejects_wrong_issuer_and_audience(self) -> None:
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(make_token(issuer="https://attacker.invalid/auth/v1"), self.config)
        with self.assertRaises(jwt.PyJWTError):
            decode_access_token(make_token(audience="anon"), self.config)

    def test_rejects_expired_token(self) -> None:
        with self.assertRaises(jwt.ExpiredSignatureError):
            decode_access_token(make_token(expires=-60), self.config)

    def test_verifies_es256_token_with_supabase_jwks_key(self) -> None:
        now = datetime.now(UTC)
        signing_key = ec.generate_private_key(ec.SECP256R1())
        token = jwt.encode(
            {
                "sub": str(TEST_USER_ID),
                "aud": "authenticated",
                "iss": f"{TEST_URL}/auth/v1",
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(minutes=2)).timestamp()),
            },
            signing_key,
            algorithm="ES256",
            headers={"kid": "unit-test-key"},
        )
        with patch("app.core.auth._jwks_client") as jwks:
            jwks.return_value.get_signing_key_from_jwt.return_value.key = signing_key.public_key()
            claims = decode_access_token(token, SupabaseConfig(TEST_URL, "test-anon-key"))
        self.assertEqual(claims["sub"], str(TEST_USER_ID))

    def test_role_guard_uses_profile_role(self) -> None:
        guard = require_roles("canteen_staff", "admin")
        staff = AuthContext(TEST_USER_ID, "canteen_staff", "active", "Staff", None, datetime.now(UTC), "token")
        student = AuthContext(TEST_USER_ID, "student", "active", "Student", None, datetime.now(UTC), "token")

        async def check() -> None:
            self.assertIs(await guard(staff), staff)
            with self.assertRaises(HTTPException) as error:
                await guard(student)
            self.assertEqual(error.exception.status_code, 403)

        asyncio.run(check())

    def test_auth_dependency_takes_role_from_profile_not_token_metadata(self) -> None:
        profile = ProfileRecord(
            id=TEST_USER_ID,
            full_name="Test Student",
            student_id="S-101",
            role="student",
            account_status="active",
            created_at=datetime.now(UTC),
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=make_token())

        async def check() -> AuthContext:
            with (
                patch.dict(
                    os.environ,
                    {
                        "SUPABASE_URL": TEST_URL,
                        "SUPABASE_ANON_KEY": "test-anon-key",
                        "SUPABASE_JWT_SECRET": TEST_SECRET,
                    },
                ),
                patch("app.services.profiles.fetch_profile", new_callable=AsyncMock) as fetch_profile_mock,
            ):
                fetch_profile_mock.return_value = profile
                user = await get_current_user(credentials)
                fetch_profile_mock.assert_awaited_once()
                return user

        user = asyncio.run(check())
        self.assertEqual(user.role, "student")

    def test_auth_dependency_blocks_inactive_profile(self) -> None:
        profile = ProfileRecord(
            id=TEST_USER_ID,
            full_name="Suspended Student",
            student_id="S-101",
            role="admin",
            account_status="suspended",
            created_at=datetime.now(UTC),
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=make_token())

        async def check() -> None:
            with (
                patch.dict(
                    os.environ,
                    {
                        "SUPABASE_URL": TEST_URL,
                        "SUPABASE_ANON_KEY": "test-anon-key",
                        "SUPABASE_JWT_SECRET": TEST_SECRET,
                    },
                ),
                patch("app.services.profiles.fetch_profile", new_callable=AsyncMock) as fetch_profile_mock,
            ):
                fetch_profile_mock.return_value = profile
                with self.assertRaises(HTTPException) as error:
                    await get_current_user(credentials)
                self.assertEqual(error.exception.status_code, 403)

        asyncio.run(check())

    def test_profile_route_requires_a_bearer_token(self) -> None:
        async def request() -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.get("/api/me")

        response = asyncio.run(request())
        self.assertEqual(response.status_code, 401)

    def test_profile_route_returns_verified_profile_data(self) -> None:
        user = AuthContext(
            TEST_USER_ID,
            "student",
            "active",
            "Test Student",
            "S-101",
            datetime.now(UTC),
            "test-access-token",
        )

        async def request() -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.get("/api/me", headers={"Authorization": "Bearer test-token"})

        with patch.dict(os.environ, {"SUPABASE_URL": TEST_URL, "SUPABASE_ANON_KEY": "test-anon-key"}):
            app.dependency_overrides[get_current_user] = lambda: user
            try:
                response = asyncio.run(request())
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], str(TEST_USER_ID))
        self.assertEqual(response.json()["role"], "student")
        self.assertNotIn("access_token", response.json())

    def test_profile_patch_allows_only_self_service_fields(self) -> None:
        user = AuthContext(
            TEST_USER_ID,
            "student",
            "active",
            "Test Student",
            "S-101",
            datetime.now(UTC),
            "test-access-token",
        )
        updated = {
            "id": TEST_USER_ID,
            "full_name": "Updated Student",
            "student_id": "S-101",
            "role": "student",
            "account_status": "active",
            "created_at": datetime.now(UTC),
        }

        async def request() -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.patch("/api/me/profile", json={"full_name": "  Updated Student  "})

        with (
            patch.dict(os.environ, {"SUPABASE_URL": TEST_URL, "SUPABASE_ANON_KEY": "test-anon-key"}),
            patch("app.api.profile.update_profile", new_callable=AsyncMock) as update_profile_mock,
        ):
            update_profile_mock.return_value = ProfileRecord.model_validate(updated)
            app.dependency_overrides[get_current_user] = lambda: user
            try:
                response = asyncio.run(request())
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["full_name"], "Updated Student")
        self.assertEqual(update_profile_mock.await_args.args[3], {"full_name": "Updated Student"})

    def test_profile_patch_rejects_client_supplied_role(self) -> None:
        user = AuthContext(
            TEST_USER_ID,
            "student",
            "active",
            "Test Student",
            "S-101",
            datetime.now(UTC),
            "test-access-token",
        )

        async def request() -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                return await client.patch("/api/me/profile", json={"role": "admin"})

        with patch.dict(os.environ, {"SUPABASE_URL": TEST_URL, "SUPABASE_ANON_KEY": "test-anon-key"}):
            app.dependency_overrides[get_current_user] = lambda: user
            try:
                response = asyncio.run(request())
            finally:
                app.dependency_overrides.pop(get_current_user, None)

        self.assertEqual(response.status_code, 422)

    def test_delete_profile_removes_user_data_and_blocks_further_access(self) -> None:
        from app.services.dev_store import create_dev_order, get_dev_orders, DEV_ORDERS
        from app.services.profiles import delete_profile, fetch_profile, is_user_deleted, reset_dev_profiles

        reset_dev_profiles()
        test_uid = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

        # 1. Create order for test user
        order = create_dev_order(
            [{"menu_item_id": "10000000-0000-0000-0000-000000000001", "quantity": 2}],
            "online",
            user_id=test_uid,
        )
        self.assertEqual(len(get_dev_orders(test_uid)), 1)

        # 2. Delete profile
        config = SupabaseConfig(TEST_URL, "test-anon-key")
        result = asyncio.run(delete_profile(config, "test-token", test_uid))
        self.assertEqual(result["status"], "ok")
        self.assertTrue(is_user_deleted(test_uid))

        # 3. Orders for deleted user must be completely gone (empty list, not all orders)
        user_orders = get_dev_orders(test_uid)
        self.assertEqual(user_orders, [])

        # 4. Accessing profile for deleted user must be rejected with 401
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(fetch_profile(config, "test-token", test_uid))
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("deleted", ctx.exception.detail.lower())


if __name__ == "__main__":
    unittest.main()
