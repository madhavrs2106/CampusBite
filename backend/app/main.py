import os
from typing import Any
from pathlib import Path
from dotenv import load_dotenv

# Search and load .env file from backend or project root
for candidate in [
    Path.cwd() / ".env",
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent.parent.parent / ".env",
    Path(__file__).resolve().parent.parent.parent / "backend" / ".env",
]:
    if candidate.is_file():
        load_dotenv(dotenv_path=candidate, override=False)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.menu import router as menu_router
from app.api.profile import router as profile_router
from app.api.orders import router as orders_router
from app.api.staff import router as staff_router
from app.api.admin import router as admin_router
from app.api.payments import router as payments_router

app = FastAPI(title="CampusBite API", version="0.1.0", description="Development foundation for CampusBite.")

configured_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")).split(",")
    if origin.strip()
]
default_dev_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://campus-bite-delta.vercel.app",
]
allowed_origins = list(dict.fromkeys(configured_origins + default_dev_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/.*\.vercel\.app)$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(menu_router, prefix="/api")
app.include_router(profile_router, prefix="/api")
app.include_router(orders_router, prefix="/api")
app.include_router(staff_router, prefix="/api")
app.include_router(admin_router, prefix="/api", include_in_schema=False)
app.include_router(payments_router, prefix="/api")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "campusbite-api", "mode": "development-sample-data"}


@app.post("/api/dev/reset")
@app.get("/api/dev/reset")
def reset_dev_database() -> dict[str, Any]:
    from app.services.dev_store import reset_dev_store
    from app.services.profiles import reset_dev_profiles
    reset_dev_store()
    reset_dev_profiles()
    return {
        "status": "ok",
        "message": "Localhost development database cleared successfully: 0 orders, token counter reset to 101, all menu items set to available.",
    }

