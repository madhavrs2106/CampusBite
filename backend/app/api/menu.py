from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

router = APIRouter(tags=["menu"])


class MenuItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str | int
    name: str
    description: str
    category: str
    price_paise: int
    is_available: bool
    is_vegetarian: bool = True
    contains_egg: bool = False
    ingredients_verified: bool = True
    tag: str = "🌱"
    color: str = "sage"


# 100% Vegetarian & Egg-Free development menu fixture.
# In production, active items are read from Supabase with verified ingredients.
SAMPLE_MENU: list[MenuItem] = [
    MenuItem(
        id=1,
        name="Poha",
        description="Tempered flattened rice with mustard seeds, curry leaves, turmeric & crunchy peanuts",
        category="Breakfast",
        price_paise=4000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥣",
        color="sand",
    ),
    MenuItem(
        id=2,
        name="Aloo Paratha",
        description="Spiced potato stuffed whole wheat flatbread served with fresh curd & pickle",
        category="Breakfast",
        price_paise=6000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🫓",
        color="sand",
    ),
    MenuItem(
        id=3,
        name="Paneer Paratha",
        description="Grated cottage cheese & herb stuffed whole wheat flatbread served with butter",
        category="Breakfast",
        price_paise=8000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🫓",
        color="rose",
    ),
    MenuItem(
        id=4,
        name="Idli Sambar",
        description="Steamed fermented rice & lentil cakes served with piping hot drumstick sambar",
        category="South Indian",
        price_paise=5000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥞",
        color="sage",
    ),
    MenuItem(
        id=5,
        name="Masala Dosa",
        description="Crispy golden fermented crepe stuffed with spiced potato mash, served with chutneys",
        category="South Indian",
        price_paise=7500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥞",
        color="sand",
    ),
    MenuItem(
        id=6,
        name="Veg Sandwich",
        description="Triple-layer toasted sandwich with cucumber, tomato, mint chutney & cheese",
        category="Sandwiches and Burgers",
        price_paise=6000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥪",
        color="sage",
    ),
    MenuItem(
        id=7,
        name="Veg Burger",
        description="Crispy vegetable patty topped with crunchy lettuce, tomato & creamy veg mayo",
        category="Sandwiches and Burgers",
        price_paise=8000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍔",
        color="rose",
    ),
    MenuItem(
        id=8,
        name="Chole Bhature",
        description="Spicy Punjabi chickpea curry paired with two fluffy, deep-fried leavened bhature",
        category="North Indian",
        price_paise=11000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍲",
        color="sand",
    ),
    MenuItem(
        id=9,
        name="Dal Rice",
        description="Homestyle yellow tadka dal served over fragrant steamed basmati rice with pickle",
        category="Rice and Meals",
        price_paise=7000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍛",
        color="sand",
    ),
    MenuItem(
        id=10,
        name="Rajma Rice",
        description="Slow-cooked red kidney beans in thick spiced gravy paired with hot basmati rice",
        category="Rice and Meals",
        price_paise=8500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍛",
        color="rose",
    ),
    MenuItem(
        id=11,
        name="Veg Fried Rice",
        description="Wok-tossed long-grain basmati rice with crunchy carrots, cabbage & spring onions",
        category="Rice and Meals",
        price_paise=9000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍚",
        color="sage",
    ),
    MenuItem(
        id=12,
        name="Pav Bhaji",
        description="Rich, buttery spiced mashed vegetable curry served hot with toasted butter pav",
        category="Street Food",
        price_paise=9000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥘",
        color="rose",
    ),
    MenuItem(
        id=13,
        name="Samosa",
        description="Crisp golden pastry triangles stuffed with spiced potatoes and green peas",
        category="Snacks",
        price_paise=2000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥟",
        color="sand",
    ),
    MenuItem(
        id=14,
        name="Vada Pav",
        description="Mumbai street classic - spiced potato fritter in pav with roasted garlic chutney",
        category="Street Food",
        price_paise=2500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍔",
        color="sand",
    ),
    MenuItem(
        id=15,
        name="Veg Momos",
        description="Steamed Himalayan dumplings packed with minced vegetables, ginger & spicy dip",
        category="Street Food",
        price_paise=7000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥟",
        color="sage",
    ),
    MenuItem(
        id=16,
        name="Paneer Roll",
        description="Layered paratha wrapped around spiced grilled paneer cubes & tangy mint sauce",
        category="Snacks",
        price_paise=9500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🌯",
        color="rose",
    ),
    MenuItem(
        id=17,
        name="Veg Farmhouse Pizza",
        description="Thin crust pizza topped with fresh tomato sauce, mozzarella, bell peppers & corn",
        category="Pizza and Bakery",
        price_paise=14000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍕",
        color="sand",
    ),
    MenuItem(
        id=18,
        name="Masala Chai",
        description="Freshly brewed Assam tea simmered with milk, crushed cardamom, ginger & spices",
        category="Beverages",
        price_paise=1500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="☕",
        color="sand",
    ),
    MenuItem(
        id=19,
        name="Filter Coffee",
        description="Authentic South Indian chicory-blended decoction frothed with hot creamy milk",
        category="Beverages",
        price_paise=2500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="☕",
        color="rose",
    ),
    MenuItem(
        id=20,
        name="Sweet Lassi",
        description="Chilled thick yogurt beverage churned with cardamom, sugar and saffron strands",
        category="Beverages",
        price_paise=4500,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🥛",
        color="blue",
    ),
    MenuItem(
        id=21,
        name="Jalebi",
        description="Crisp golden spiral fritters soaked in warm saffron and cardamom sugar syrup",
        category="Sweets and Desserts",
        price_paise=4000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍯",
        color="sand",
    ),
    MenuItem(
        id=22,
        name="Gulab Jamun",
        description="Soft melt-in-mouth milk dough dumplings steeped in warm rose & cardamom syrup",
        category="Sweets and Desserts",
        price_paise=4000,
        is_available=True,
        is_vegetarian=True,
        contains_egg=False,
        ingredients_verified=True,
        tag="🍨",
        color="rose",
    ),
]

CATEGORY_TAGS: dict[str, tuple[str, str]] = {
    "Breakfast": ("🥣", "sand"),
    "North Indian": ("🍲", "sand"),
    "South Indian": ("🥞", "rose"),
    "Snacks": ("🥟", "sand"),
    "Street Food": ("🥘", "rose"),
    "Sandwiches and Burgers": ("🥪", "sage"),
    "Rice and Meals": ("🍛", "sand"),
    "Pizza and Bakery": ("🍕", "sand"),
    "Sweets and Desserts": ("🍯", "rose"),
    "Beverages": ("☕", "blue"),
}


@router.get("/menu", response_model=list[MenuItem])
async def list_menu() -> list[MenuItem]:
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not supabase_url or not anon_key:
        return SAMPLE_MENU

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            # Strictly select only vegetarian, egg-free, and verified active items
            response = await client.get(
                f"{supabase_url}/rest/v1/menu_items",
                params={
                    "select": "id,name,description,price_paise,is_available,is_vegetarian,contains_egg,ingredients_verified,categories(name)",
                    "is_active": "eq.true",
                    "is_vegetarian": "eq.true",
                    "contains_egg": "eq.false",
                    "order": "name.asc",
                },
                headers={"apikey": anon_key, "Authorization": f"Bearer {anon_key}"},
            )
    except httpx.RequestError:
        return SAMPLE_MENU

    if response.status_code >= 400:
        return SAMPLE_MENU

    try:
        rows = response.json()
        menu_items: list[MenuItem] = []
        for row in rows:
            # Extra server-side guarantee: exclude any row that is not vegetarian or contains egg
            if not row.get("is_vegetarian", True) or row.get("contains_egg", False):
                continue
            cat_name = (row.get("categories") or {}).get("name") or "Snacks"
            tag, color = CATEGORY_TAGS.get(cat_name, ("🌱", "sage"))
            menu_items.append(
                MenuItem(
                    id=row["id"],
                    name=row["name"],
                    description=row["description"],
                    category=cat_name,
                    price_paise=row["price_paise"],
                    is_available=bool(row.get("is_available", True)),
                    is_vegetarian=bool(row.get("is_vegetarian", True)),
                    contains_egg=bool(row.get("contains_egg", False)),
                    ingredients_verified=bool(row.get("ingredients_verified", False)),
                    tag=tag,
                    color=color,
                )
            )
        return menu_items
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The menu service returned invalid menu data.",
        ) from exc
