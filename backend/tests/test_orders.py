from __future__ import annotations

import asyncio
import os
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
from fastapi import HTTPException

from app.core.auth import AuthContext, get_current_user
from app.main import app
from app.services.orders import _raise_order_error

USER_ID = UUID("8607d5e0-7ac5-48dc-9106-2f2f39ec78cd")
ITEM_ID = UUID("b3b9df4f-bd8f-4e54-b4a6-4c977e71e20b")
ORDER_ID = UUID("3858ec6f-72a7-4be2-a6b5-ec6ba344a0a4")
REQUEST_ID = UUID("97c09af4-cec8-4bf2-8dc0-f63a0f302f91")


class OrderRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = AuthContext(
            USER_ID, "student", "active", "Test Student", "S-101", datetime.now(UTC), "user-access-token"
        )

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async def run() -> httpx.Response:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                return await client.request(method, path, **kwargs)

        with patch.dict(os.environ, {"SUPABASE_URL": "https://campusbite-test.supabase.co", "SUPABASE_ANON_KEY": "test-anon-key"}):
            app.dependency_overrides[get_current_user] = lambda: self.user
            try:
                return asyncio.run(run())
            finally:
                app.dependency_overrides.pop(get_current_user, None)

    def test_student_can_place_pay_at_pickup_order(self) -> None:
        order = {"id": str(ORDER_ID), "token_number": "A1B2C3D4", "status": "placed", "total_paise": 15000, "items": []}
        with patch("app.api.orders.create_order", new_callable=AsyncMock, return_value=order) as create:
            response = self.request("POST", "/api/orders", json={
                "items": [{"menu_item_id": str(ITEM_ID), "quantity": 2}],
                "payment_method": "pay_at_pickup",
                "client_request_id": str(REQUEST_ID),
            })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["token_number"], "A1B2C3D4")
        self.assertEqual(create.await_args.kwargs["items"], [{"menu_item_id": str(ITEM_ID), "quantity": 2}])
        self.assertEqual(create.await_args.kwargs["client_request_id"], REQUEST_ID)

    def test_client_cannot_supply_price_or_total(self) -> None:
        response = self.request("POST", "/api/orders", json={
            "items": [{"menu_item_id": str(ITEM_ID), "quantity": 1, "unit_price_paise": 1}],
            "payment_method": "pay_at_pickup",
            "client_request_id": str(REQUEST_ID),
            "total_paise": 1,
        })
        self.assertEqual(response.status_code, 422)

    def test_client_quantity_must_be_an_integer_within_bounds(self) -> None:
        response = self.request("POST", "/api/orders", json={
            "items": [{"menu_item_id": str(ITEM_ID), "quantity": 100}],
            "payment_method": "pay_at_pickup",
            "client_request_id": str(REQUEST_ID),
        })
        self.assertEqual(response.status_code, 422)

    def test_student_order_list_is_scoped_to_authenticated_user(self) -> None:
        with patch("app.api.orders.list_orders", new_callable=AsyncMock, return_value=[]) as list_mock:
            response = self.request("GET", "/api/orders")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(list_mock.await_args.kwargs["user_id"], USER_ID)

    def test_database_unavailable_item_maps_to_conflict(self) -> None:
        response = httpx.Response(400, json={"code": "23514", "message": "A menu item is unavailable"})
        with self.assertRaises(HTTPException) as error:
            _raise_order_error(response)
        self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
