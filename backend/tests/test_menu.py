import asyncio
import unittest
import httpx
from app.main import app

class MenuApiTests(unittest.TestCase):
    def test_health_and_sample_menu(self) -> None:
        async def check_routes() -> None:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                health = await client.get("/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "ok")

                response = await client.get("/api/menu")
                self.assertEqual(response.status_code, 200)
                menu = response.json()
                self.assertGreaterEqual(len(menu), 20)
                self.assertTrue(all(item["is_available"] for item in menu))
                self.assertTrue(all(item["is_vegetarian"] for item in menu))
                self.assertTrue(all(not item["contains_egg"] for item in menu))
                self.assertTrue(all(item["ingredients_verified"] for item in menu))
                self.assertTrue(all(isinstance(item["price_paise"], int) for item in menu))

        asyncio.run(check_routes())

if __name__ == "__main__":
    unittest.main()
