-- Payment records are written only through trusted database functions.
create unique index payments_one_razorpay_per_order
  on public.payments(order_id) where provider = 'razorpay';

create or replace function public.attach_razorpay_order(p_order_id uuid, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id <> auth.uid() then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'online' or v_order.payment_status <> 'pending' or v_order.status <> 'placed' then
    raise exception 'Order is not payable' using errcode = '23514';
  end if;
  select * into v_payment from public.payments where order_id = p_order_id and provider = 'razorpay' for update;
  if found then
    if v_payment.provider_order_id is not null and v_payment.provider_order_id <> p_provider_order_id then
      raise exception 'A different gateway order already exists' using errcode = '23514';
    end if;
    update public.payments set provider_order_id = p_provider_order_id where id = v_payment.id returning * into v_payment;
  else
    insert into public.payments(order_id,provider,provider_order_id,amount_paise,status)
      values(p_order_id,'razorpay',p_provider_order_id,v_order.total_paise,'created') returning * into v_payment;
  end if;
  return jsonb_build_object('id',v_order.id,'total_paise',v_order.total_paise,'currency','INR','provider_order_id',v_payment.provider_order_id);
end $$;

create or replace function public.confirm_razorpay_payment(p_order_id uuid, p_gateway_order_id text, p_payment_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (auth.uid() is not null and v_order.user_id <> auth.uid()) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_payment from public.payments where order_id = p_order_id and provider = 'razorpay' for update;
  if not found or v_payment.provider_order_id <> p_gateway_order_id then raise exception 'Payment order mismatch' using errcode = '23514'; end if;
  if v_order.payment_status = 'paid' then return jsonb_build_object('payment_status','paid'); end if;
  if v_order.payment_status <> 'pending' or v_order.status not in ('placed','accepted','preparing','ready') then
    raise exception 'Order cannot be paid in its current state' using errcode = '23514';
  end if;
  update public.payments set provider_payment_id = p_payment_id,status = 'paid' where id = v_payment.id;
  update public.orders set payment_status = 'paid' where id = p_order_id;
  insert into public.audit_logs(actor_user_id,action,target_type,target_id,details)
    values(coalesce(auth.uid(),v_order.user_id),'razorpay_payment_confirmed','order',p_order_id::text,jsonb_build_object('payment_id',p_payment_id));
  return jsonb_build_object('payment_status','paid');
end $$;

create or replace function public.process_razorpay_webhook(p_event_id text,p_event_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entity jsonb; v_order public.orders%rowtype; v_payment public.payments%rowtype; v_payment_id text; v_gateway_order_id text; v_amount integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if length(p_event_id) not between 1 and 200 then raise exception 'Invalid event ID' using errcode = '22023'; end if;
  insert into public.payment_webhook_events(provider,event_id,event_type,payload)
    values('razorpay',p_event_id,p_event_type,p_payload) on conflict(event_id) do nothing;
  if not found then return jsonb_build_object('duplicate',true); end if;
  v_entity := coalesce(p_payload #> '{payload,payment,entity}',p_payload #> '{payload,order,entity}');
  v_payment_id := case when p_event_type like 'payment.%' then v_entity->>'id' else null end;
  v_gateway_order_id := coalesce(v_entity->>'order_id',case when p_event_type='order.paid' then v_entity->>'id' end);
  v_amount := nullif(v_entity->>'amount','')::integer;
  if p_event_type in ('payment.captured','order.paid') then
    select * into v_payment from public.payments where provider='razorpay' and provider_order_id=v_gateway_order_id for update;
    if not found or v_amount is null or v_amount <> v_payment.amount_paise then
      update public.payment_webhook_events set processing_error='Payment order or amount did not match.' where event_id=p_event_id;
      return jsonb_build_object('processed',false,'reason','payment_mismatch');
    end if;
    select * into v_order from public.orders where id=v_payment.order_id for update;
    update public.payments set provider_payment_id=coalesce(v_payment_id,provider_payment_id),status='paid' where id=v_payment.id;
    if v_order.status in ('placed','accepted','preparing','ready') and v_order.payment_status='pending' then
      update public.orders set payment_status='paid' where id=v_order.id;
    else
      update public.payment_webhook_events set processing_error='Late payment needs staff refund review.' where event_id=p_event_id;
    end if;
  elsif p_event_type in ('payment.failed') then
    update public.payments set provider_payment_id=coalesce(v_payment_id,provider_payment_id),status='failed'
      where provider='razorpay' and provider_order_id=v_gateway_order_id and status <> 'paid';
  end if;
  update public.payment_webhook_events set processed_at=now() where event_id=p_event_id;
  return jsonb_build_object('processed',true);
end $$;

revoke all on function public.attach_razorpay_order(uuid,text) from public,anon;
revoke all on function public.confirm_razorpay_payment(uuid,text,text) from public,anon;
revoke all on function public.process_razorpay_webhook(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attach_razorpay_order(uuid,text) to authenticated;
grant execute on function public.confirm_razorpay_payment(uuid,text,text) to authenticated,service_role;
grant execute on function public.process_razorpay_webhook(text,text,jsonb) to service_role;
