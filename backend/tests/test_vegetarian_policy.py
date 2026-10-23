from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
from fastapi import HTTPException

from app.api.staff import MenuItemCreate, MenuItemPatch, add_menu_item, update_menu_item
from app.core.auth import AuthContext, SupabaseConfig
from app.main import app

USER_ID = UUID("8607d5e0-7ac5-48dc-9106-2f2f39ec78cd")
ITEM_ID = UUID("b3b9df4f-bd8f-4e54-b4a6-4c977e71e20b")


class VegetarianPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.staff_user = AuthContext(
            USER_ID, "canteen_staff", "active", "Chef Sharma", None, datetime.now(UTC), "staff-token"
        )
        self.config = SupabaseConfig(url="https://test.supabase.co", anon_key="test-key")

    def test_all_sample_menu_items_are_strictly_vegetarian_and_egg_free(self) -> None:
        async def run() -> None:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/menu")
                self.assertEqual(response.status_code, 200)
                items = response.json()
                self.assertGreaterEqual(len(items), 20)
                for item in items:
                    self.assertTrue(item.get("is_vegetarian"), f"{item['name']} must be vegetarian")
                    self.assertFalse(item.get("contains_egg"), f"{item['name']} must be egg-free")
                    self.assertTrue(item.get("ingredients_verified"), f"{item['name']} ingredients must be verified")

        asyncio.run(run())

    def test_staff_cannot_create_non_vegetarian_item(self) -> None:
        async def run() -> None:
            body = MenuItemCreate(
                name="Chicken Biryani",
                price_paise=15000,
                is_vegetarian=False,
                contains_egg=False,
                ingredients_verified=True,
                is_available=True,
            )
            with self.assertRaises(HTTPException) as exc:
                await add_menu_item(body, self.staff_user, self.config)
            self.assertEqual(exc.exception.status_code, 422)
            self.assertIn("vegetarian", exc.exception.detail.lower())

        asyncio.run(run())

    def test_staff_cannot_create_egg_containing_item(self) -> None:
        async def run() -> None:
            body = MenuItemCreate(
                name="Egg Fried Rice",
                price_paise=9000,
                is_vegetarian=True,
                contains_egg=True,
                ingredients_verified=True,
                is_available=True,
            )
            with self.assertRaises(HTTPException) as exc:
                await add_menu_item(body, self.staff_user, self.config)
            self.assertEqual(exc.exception.status_code, 422)
            self.assertIn("egg", exc.exception.detail.lower())

    def test_unverified_item_cannot_be_published_as_available(self) -> None:
        async def run() -> None:
            body = MenuItemCreate(
                name="Veg Cutlet",
                price_paise=5000,
                is_vegetarian=True,
                contains_egg=False,
                ingredients_verified=False,
                is_available=True,
            )
            with self.assertRaises(HTTPException) as exc:
                await add_menu_item(body, self.staff_user, self.config)
            self.assertEqual(exc.exception.status_code, 422)
            self.assertIn("verified", exc.exception.detail.lower())

    def test_updating_item_to_non_veg_is_rejected(self) -> None:
        async def run() -> None:
            body = MenuItemPatch(is_vegetarian=False)
            with self.assertRaises(HTTPException) as exc:
                await update_menu_item(ITEM_ID, body, self.staff_user, self.config)
            self.assertEqual(exc.exception.status_code, 422)

        asyncio.run(run())

    def test_recipe_change_requires_reverification(self) -> None:
        async def run() -> None:
            existing_record = {
                "id": str(ITEM_ID),
                "name": "Paneer Roll",
                "description": "Original recipe with grilled paneer",
                "price_paise": 9500,
                "is_available": True,
                "is_vegetarian": True,
                "contains_egg": False,
                "ingredients_verified": True,
            }
            with patch("app.api.staff._request") as mock_req:
                mock_req.return_value = httpx.Response(200, json=[existing_record])
                # When updating description (recipe changed) without re-verifying, it cannot be available
                body = MenuItemPatch(description="New spicy schezwan paneer filling")
                with self.assertRaises(HTTPException) as exc:
                    await update_menu_item(ITEM_ID, body, self.staff_user, self.config)
                self.assertEqual(exc.exception.status_code, 422)
                self.assertIn("verified", exc.exception.detail.lower())

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
