from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.core.auth import AuthContext, SupabaseConfig, get_current_user, get_supabase_config, require_roles
from app.services.orders import create_order, get_order, list_orders, transition_order

router = APIRouter(prefix="/orders", tags=["orders"])


class OrderLineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    menu_item_id: UUID
    quantity: StrictInt = Field(ge=1, le=99)


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[OrderLineRequest] = Field(min_length=1, max_length=30)
    payment_method: Literal["online", "pay_at_pickup"]
    client_request_id: UUID


class TransitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next_status: Literal["accepted", "preparing", "ready", "collected", "declined", "cancelled"]
    decline_reason: str | None = Field(default=None, max_length=500)


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_order(
    body: CreateOrderRequest,
    user: Annotated[AuthContext, Depends(require_roles("student", "faculty", "canteen_staff"))],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict:
    return await create_order(
        config,
        user.access_token,
        items=[line.model_dump(mode="json") for line in body.items],
        payment_method=body.payment_method,
        client_request_id=body.client_request_id,
        user_id=user.user_id,
    )


@router.get("")
async def get_orders(
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> list[dict]:
    if user.role in {"student", "faculty"}:
        owner_id = user.user_id
    elif user.role in {"canteen_staff", "admin"}:
        owner_id = None
    else:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="This role cannot view orders.")
    return await list_orders(config, user.access_token, user_id=owner_id)


@router.get("/{order_id}")
async def get_order_by_id(
    order_id: UUID,
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict:
    return await get_order(config, user.access_token, order_id)


@router.post("/{order_id}/transitions")
async def post_order_transition(
    order_id: UUID,
    body: TransitionRequest,
    user: Annotated[AuthContext, Depends(get_current_user)],
    config: Annotated[SupabaseConfig, Depends(get_supabase_config)],
) -> dict:
    if body.next_status == "cancelled" and user.role not in {"student", "faculty"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Only students and faculty can request order cancellation.")
    if body.next_status != "cancelled" and user.role not in {"canteen_staff", "admin"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Staff access is required for this status change.")

    return await transition_order(
        config,
        user.access_token,
        order_id=order_id,
        next_status=body.next_status,
        decline_reason=body.decline_reason,
    )
