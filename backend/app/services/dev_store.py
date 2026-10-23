from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

# In-memory storage for development when Supabase tables are not yet created
DEV_CATEGORIES = [
    {"id": "cat-breakfast", "name": "Breakfast", "is_active": True},
    {"id": "cat-south-indian", "name": "South Indian", "is_active": True},
    {"id": "cat-snacks", "name": "Snacks", "is_active": True},
    {"id": "cat-beverages", "name": "Beverages", "is_active": True},
    {"id": "cat-meals", "name": "Meals", "is_active": True},
]

DEV_MENU_ITEMS: list[dict[str, Any]] = [
    {
        "id": "10000000-0000-0000-0000-000000000001",
        "name": "Poha",
        "description": "Tempered flattened rice with mustard seeds, curry leaves, turmeric & crunchy peanuts",
        "price_paise": 4000,
        "category_id": "cat-breakfast",
        "categories": {"name": "Breakfast"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🥣",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000002",
        "name": "Aloo Paratha",
        "description": "Spiced potato stuffed whole wheat flatbread served with fresh curd & pickle",
        "price_paise": 6000,
        "category_id": "cat-breakfast",
        "categories": {"name": "Breakfast"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🫓",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000003",
        "name": "Paneer Paratha",
        "description": "Grated cottage cheese & herb stuffed whole wheat flatbread served with butter",
        "price_paise": 8000,
        "category_id": "cat-breakfast",
        "categories": {"name": "Breakfast"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🫓",
        "color": "rose",
    },
    {
        "id": "10000000-0000-0000-0000-000000000004",
        "name": "Idli Sambar",
        "description": "Steamed fermented rice & lentil cakes served with piping hot drumstick sambar",
        "price_paise": 5000,
        "category_id": "cat-south-indian",
        "categories": {"name": "South Indian"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🥞",
        "color": "sage",
    },
    {
        "id": "10000000-0000-0000-0000-000000000005",
        "name": "Masala Dosa",
        "description": "Crispy golden fermented crepe stuffed with spiced potato mash, served with chutneys",
        "price_paise": 7500,
        "category_id": "cat-south-indian",
        "categories": {"name": "South Indian"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🥞",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000006",
        "name": "Veg Sandwich",
        "description": "Triple-layer toasted sandwich with cucumber, tomato, mint chutney & cheese",
        "price_paise": 5000,
        "category_id": "cat-snacks",
        "categories": {"name": "Snacks"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🥪",
        "color": "sage",
    },
    {
        "id": "10000000-0000-0000-0000-000000000007",
        "name": "Samosa (2 pcs)",
        "description": "Flaky golden pastry filled with spiced potato & green peas, served with sweet & spicy chutneys",
        "price_paise": 3000,
        "category_id": "cat-snacks",
        "categories": {"name": "Snacks"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🥟",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000008",
        "name": "Masala Chai",
        "description": "Traditional Indian spiced milk tea brewed with ginger, cardamom, cloves & cinnamon",
        "price_paise": 2000,
        "category_id": "cat-beverages",
        "categories": {"name": "Beverages"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "☕",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000009",
        "name": "Filter Coffee",
        "description": "Authentic South Indian chicory blend filter coffee with frothy hot milk",
        "price_paise": 3000,
        "category_id": "cat-beverages",
        "categories": {"name": "Beverages"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "☕",
        "color": "sand",
    },
    {
        "id": "10000000-0000-0000-0000-000000000010",
        "name": "Special Veg Thali",
        "description": "2 rotis, paneer sabzi, dal tadka, jeera rice, fresh salad, pickle, papad & sweet gulab jamun",
        "price_paise": 12000,
        "category_id": "cat-meals",
        "categories": {"name": "Meals"},
        "is_available": True,
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": True,
        "tag": "🍱",
        "color": "sand",
    },
]

DEV_ORDERS: list[dict[str, Any]] = []

token_counter = 101


def reset_dev_store() -> None:
    global token_counter
    DEV_ORDERS.clear()
    token_counter = 101
    for item in DEV_MENU_ITEMS:
        item["is_available"] = True



def get_dev_staff_menu() -> list[dict[str, Any]]:
    return [dict(i) for i in DEV_MENU_ITEMS]


def get_dev_categories() -> list[dict[str, Any]]:
    return list(DEV_CATEGORIES)


def update_dev_menu_item(item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    for item in DEV_MENU_ITEMS:
        if str(item["id"]) == str(item_id):
            item.update(patch)
            if "category_id" in patch:
                cat = next((c for c in DEV_CATEGORIES if c["id"] == patch["category_id"]), None)
                if cat:
                    item["categories"] = {"name": cat["name"]}
            return dict(item)
    # If not found, return dummy
    dummy = {"id": str(item_id), "name": "Menu Item", **patch}
    DEV_MENU_ITEMS.append(dummy)
    return dummy


def add_dev_menu_item(payload: dict[str, Any]) -> dict[str, Any]:
    new_id = str(uuid4())
    cat = next((c for c in DEV_CATEGORIES if c["id"] == payload.get("category_id")), None)
    item = {
        "id": new_id,
        "name": payload["name"],
        "description": payload.get("description", ""),
        "price_paise": payload["price_paise"],
        "category_id": payload.get("category_id"),
        "categories": {"name": cat["name"]} if cat else {"name": "Snacks"},
        "is_available": payload.get("is_available", True),
        "is_active": True,
        "is_vegetarian": True,
        "contains_egg": False,
        "ingredients_verified": payload.get("ingredients_verified", True),
        "tag": "🌱",
        "color": "sage",
    }
    DEV_MENU_ITEMS.append(item)
    return item


def get_dev_orders(user_id: UUID | None = None) -> list[dict[str, Any]]:
    if user_id is None:
        return [dict(o) for o in DEV_ORDERS]
    # For a specific user, return only orders matching user_id
    matching = [o for o in DEV_ORDERS if o.get("user_id") == str(user_id)]
    return [dict(o) for o in matching]


def delete_dev_user_orders(user_id: UUID | str) -> int:
    uid_str = str(user_id)
    matching = [o for o in DEV_ORDERS if o.get("user_id") == uid_str]
    count = len(matching)
    for o in matching:
        try:
            DEV_ORDERS.remove(o)
        except ValueError:
            pass
    return count


def get_dev_order_by_id(order_id: str) -> dict[str, Any] | None:
    for o in DEV_ORDERS:
        if str(o["id"]) == str(order_id) or str(o.get("token_number")) == str(order_id):
            return dict(o)
    return None


def transition_dev_order(order_id: str, next_status: str, decline_reason: str | None = None) -> dict[str, Any]:
    for order in DEV_ORDERS:
        if str(order["id"]) == str(order_id):
            order["status"] = next_status
            if decline_reason:
                order["decline_reason"] = decline_reason
            if next_status == "collected" and order.get("payment_method") == "pay_at_pickup":
                order["payment_status"] = "paid"
            return dict(order)
    raise KeyError(f"Order {order_id} not found in dev orders")


def create_dev_order(items: list[dict[str, Any]], payment_method: str, user_id: UUID | None = None) -> dict[str, Any]:
    global token_counter
    token_str = str(token_counter)
    token_counter += 1

    lines = []
    total = 0
    for it in items:
        m_id = str(it.get("menu_item_id"))
        qty = it.get("quantity", 1)
        menu_match = next((m for m in DEV_MENU_ITEMS if str(m["id"]) == m_id), None)
        name = menu_match["name"] if menu_match else f"Dish #{m_id}"
        price = menu_match["price_paise"] if menu_match else 5000
        line_total = price * qty
        total += line_total
        lines.append({
            "id": f"oi-{uuid4()}",
            "menu_item_id": m_id,
            "item_name": name,
            "quantity": qty,
            "unit_price_paise": price,
            "line_total_paise": line_total,
        })

    new_order = {
        "id": str(uuid4()),
        "user_id": str(user_id) if user_id else None,
        "token_number": token_str,
        "status": "placed",
        "payment_method": payment_method,
        "payment_status": "paid" if payment_method == "online" else "pending",
        "total_paise": total,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items": lines,
    }
    DEV_ORDERS.insert(0, new_order)
    return new_order
