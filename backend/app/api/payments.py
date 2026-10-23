from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import AuthContext, SupabaseConfig, get_supabase_config, require_roles
from app.api.orders import OrderLineRequest
from app.services.orders import create_order, get_order

router = APIRouter(prefix="/payments", tags=["payments"])
StudentUser = Annotated[AuthContext, Depends(require_roles("student"))]


class PaymentOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[OrderLineRequest] = Field(min_length=1, max_length=30)
    client_request_id: UUID


class PaymentVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_id: UUID
    razorpay_order_id: str = Field(min_length=1, max_length=100)
    razorpay_payment_id: str = Field(min_length=1, max_length=100)
    razorpay_signature: str = Field(min_length=1, max_length=256)


def _gateway_config() -> tuple[str, str]:
    key_id, secret = os.getenv("RAZORPAY_KEY_ID", "").strip(), os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not secret:
        raise HTTPException(status_code=503, detail="Online payments are not configured.")
    return key_id, secret


def signature_matches(secret: str, message: bytes, signature: str) -> bool:
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _rest(config: SupabaseConfig, token: str, rpc: str, payload: dict[str, Any], *, service: bool = False) -> Any:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip() if service else config.anon_key
    if not key:
        raise HTTPException(status_code=503, detail="Payment processing is not configured.")
    headers = {"apikey": key, "Authorization": f"Bearer {key if service else token}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"{config.url}/rest/v1/rpc/{rpc}", headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Payment storage is temporarily unavailable.") from exc
    if response.status_code >= 400:
        try:
            data = response.json()
        except ValueError:
            data = {}
        code = data.get("code") if isinstance(data, dict) else None
        status = 404 if code == "P0002" else 409 if code == "23514" else 502
        raise HTTPException(status_code=status, detail="Payment could not be recorded.")
    try:
        return response.json()
    except ValueError:
        return None


@router.post("/orders")
async def create_payment_order(body: PaymentOrderRequest, user: StudentUser, config: Annotated[SupabaseConfig, Depends(get_supabase_config)]) -> dict[str, Any]:
    key_id, secret = _gateway_config()
    order = await create_order(config, user.access_token, items=[item.model_dump(mode="json") for item in body.items], payment_method="online", client_request_id=body.client_request_id)
    if order.get("payment_status") == "paid":
        raise HTTPException(status_code=409, detail="This order has already been paid.")
    # Reuse the existing Razorpay order on retries. RLS limits this lookup to the owner's payments.
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            rows = await client.get(f"{config.url}/rest/v1/payments", params={"select": "provider_order_id,status", "order_id": f"eq.{order['id']}", "provider": "eq.razorpay", "limit": "1"}, headers={"apikey": config.anon_key, "Authorization": f"Bearer {user.access_token}"})
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Payment storage is temporarily unavailable.") from exc
    if rows.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not check the payment record.")
    records = rows.json()
    if records and records[0].get("provider_order_id"):
        return {"order_id": order["id"], "amount_paise": order["total_paise"], "currency": "INR", "razorpay_order_id": records[0]["provider_order_id"], "key_id": key_id}
    receipt = "cb_" + str(order["id"]).replace("-", "")[:32]
    try:
        async with httpx.AsyncClient(timeout=12.0, auth=httpx.BasicAuth(key_id, secret)) as client:
            # Razorpay receipts are unique. Looking up the deterministic receipt makes retries
            # safe even if the gateway created an order but our database write timed out.
            lookup = await client.get("https://api.razorpay.com/v1/orders", params={"receipt": receipt, "count": "10"})
            if lookup.status_code >= 400:
                raise HTTPException(status_code=502, detail="Razorpay could not check the existing payment order.")
            matches = lookup.json().get("items", [])
            gateway_order = next((item for item in matches if item.get("receipt") == receipt), None)
            if gateway_order is None:
                response = await client.post("https://api.razorpay.com/v1/orders", json={"amount": order["total_paise"], "currency": "INR", "receipt": receipt, "notes": {"campusbite_order_id": order["id"]}})
                if response.status_code >= 400:
                    # A concurrent request may have won the unique receipt race; resolve it by receipt.
                    lookup = await client.get("https://api.razorpay.com/v1/orders", params={"receipt": receipt, "count": "10"})
                    matches = lookup.json().get("items", []) if lookup.status_code < 400 else []
                    gateway_order = next((item for item in matches if item.get("receipt") == receipt), None)
                    if gateway_order is None:
                        raise HTTPException(status_code=502, detail="Razorpay could not create a payment order.")
                else:
                    gateway_order = response.json()
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Razorpay is temporarily unavailable. Retry checkout.") from exc
    if gateway_order.get("amount") != order["total_paise"] or gateway_order.get("currency") != "INR":
        raise HTTPException(status_code=502, detail="Razorpay returned an unexpected payment amount.")
    await _rest(config, user.access_token, "attach_razorpay_order", {"p_order_id": order["id"], "p_provider_order_id": gateway_order["id"]})
    return {"order_id": order["id"], "amount_paise": order["total_paise"], "currency": "INR", "razorpay_order_id": gateway_order["id"], "key_id": key_id}


@router.post("/verify")
async def verify_payment(body: PaymentVerifyRequest, user: StudentUser, config: Annotated[SupabaseConfig, Depends(get_supabase_config)]) -> dict[str, Any]:
    _, secret = _gateway_config()
    if not signature_matches(secret, f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode(), body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment signature is invalid.")
    order = await get_order(config, user.access_token, body.order_id)
    if order.get("payment_method") != "online":
        raise HTTPException(status_code=409, detail="This order is not an online payment.")
    _, key_secret = _gateway_config()
    try:
        async with httpx.AsyncClient(timeout=10.0, auth=httpx.BasicAuth(os.environ["RAZORPAY_KEY_ID"].strip(), key_secret)) as client:
            payment_response = await client.get(f"https://api.razorpay.com/v1/payments/{body.razorpay_payment_id}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Could not confirm payment with Razorpay.") from exc
    if payment_response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Razorpay payment lookup failed.")
    payment = payment_response.json()
    if payment.get("order_id") != body.razorpay_order_id or payment.get("amount") != order.get("total_paise") or payment.get("currency") != "INR" or payment.get("status") != "captured":
        raise HTTPException(status_code=409, detail="Razorpay has not confirmed the expected captured payment.")
    result = await _rest(config, user.access_token, "confirm_razorpay_payment", {"p_order_id": str(body.order_id), "p_gateway_order_id": body.razorpay_order_id, "p_payment_id": body.razorpay_payment_id})
    return {"order_id": str(body.order_id), "payment_status": result.get("payment_status", "paid") if isinstance(result, dict) else "paid"}


@router.post("/webhook")
async def razorpay_webhook(request: Request, config: Annotated[SupabaseConfig, Depends(get_supabase_config)], signature: Annotated[str | None, Header(alias="X-Razorpay-Signature")] = None, event_id: Annotated[str | None, Header(alias="X-Razorpay-Event-Id")] = None) -> dict[str, Any]:
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not webhook_secret or not signature or not event_id:
        raise HTTPException(status_code=400, detail="Webhook signature or event ID is missing.")
    raw = await request.body()
    if not signature_matches(webhook_secret, raw, signature):
        raise HTTPException(status_code=400, detail="Webhook signature is invalid.")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Webhook payload is invalid.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("event"), str):
        raise HTTPException(status_code=400, detail="Webhook payload is invalid.")
    return await _rest(config, "", "process_razorpay_webhook", {"p_event_id": event_id, "p_event_type": payload["event"], "p_payload": payload}, service=True)
