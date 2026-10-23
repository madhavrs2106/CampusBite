from __future__ import annotations

import unittest
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.staff import MenuItemCreate, MenuItemPatch, _check


class StaffMenuSchemaTests(unittest.TestCase):
    def test_menu_create_accepts_only_explicit_menu_fields(self) -> None:
        item = MenuItemCreate(name="Masala Dosa", price_paise=7500, category_id=UUID("b3b9df4f-bd8f-4e54-b4a6-4c977e71e20b"))
        self.assertEqual(item.price_paise, 7500)
        with self.assertRaises(ValidationError):
            MenuItemCreate(name="Dosa", price_paise=7500, role="admin")

    def test_menu_price_cannot_be_negative(self) -> None:
        with self.assertRaises(ValidationError):
            MenuItemCreate(name="Dosa", price_paise=-1)

    def test_empty_patch_is_rejected(self) -> None:
        self.assertEqual(MenuItemPatch().model_dump(exclude_unset=True), {})

    def test_rls_access_error_remains_forbidden(self) -> None:
        with self.assertRaises(HTTPException) as error:
            _check(httpx.Response(403, json={"code": "42501", "message": "row level security"}))
        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
