import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ChevronRight, Edit3, LogOut, RefreshCw, ShoppingBag, User, Utensils } from 'lucide-react'
import { supabase, useAuth } from './auth'
import { FssaiVegSymbol, MenuItem } from './App'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  unit_price_paise: number
  line_total_paise: number
}

type Order = {
  id: string
  token_number: string
  status: string
  payment_method: string
  payment_status: string
  total_paise: number
  created_at: string
  decline_reason?: string | null
  items: OrderItem[]
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="student-page">
      <section className="student-card">
        <div className="eyebrow">CAMPUSBITE · STUDENT</div>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}

async function apiRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail ?? 'The request could not be completed.')
  }
  return data
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  if (auth.user) return <Navigate to="/profile" replace />

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    const f = new FormData(e.currentTarget)
    try {
      if (register) {
        const confirmation = await auth.signUp(
          String(f.get('email')),
          String(f.get('password')),
          String(f.get('name')),
          String(f.get('student_id'))
        )
        if (confirmation) {
          setNotice('Account created! Please check your email to confirm your address, then sign in.')
        } else {
          navigate('/profile')
        }
      } else {
        await auth.signIn(String(f.get('email')), String(f.get('password')))
        const dest = (location.state as { from?: string } | null)?.from ?? '/profile'
        navigate(dest)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not complete request.'
      if (msg.toLowerCase().includes('email not confirmed')) {
        setError('Email not confirmed yet. In Supabase Dashboard → Authentication → Users, click on your user and choose "Confirm email", or turn off "Confirm email" under Authentication → Providers → Email.')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={register ? 'Create your account' : 'Welcome back'}>
      <p className="student-intro">
        {register
          ? 'Use your campus details to get started with fast ordering.'
          : 'Sign in to manage your campus orders.'}
      </p>
      {!auth.configured && (
        <p className="inline-alert">
          Supabase is not configured yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>frontend/.env</code>.
        </p>
      )}
      {error && <p className="inline-alert">{error}</p>}
      {notice && <p className="inline-success">{notice}</p>}
      <form className="student-form" onSubmit={submit}>
        {register && (
          <>
            <label>
              Full name
              <input name="name" required autoComplete="name" placeholder="e.g. Madhav Sharma" />
            </label>
            <label>
              Student ID / Roll No.
              <input name="student_id" required autoComplete="off" placeholder="e.g. 2026CS101" />
            </label>
          </>
        )}
        <label>
          Campus email
          <input name="email" type="email" required autoComplete="email" placeholder="student@college.edu" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
          />
        </label>
        <button className="primary-button" disabled={busy || !auth.configured}>
          {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="student-switch">
        {register ? 'Already registered?' : 'New to CampusBite?'}{' '}
        <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link>
      </p>
    </Card>
  )
}

export function ProfilePage() {
  const a = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (a.profile) {
      setName(a.profile.full_name || '')
      setStudentId(a.profile.student_id || '')
    }
  }, [a.profile])

  if (!a.user) {
    return (
      <main className="student-page">
        <section className="student-card profile-guest-card-full">
          <div className="eyebrow">CAMPUSBITE · STUDENT PROFILE</div>
          <div className="guest-badge-icon" style={{ marginTop: '20px' }}>
            <User size={30} />
          </div>
          <h1>Student Profile</h1>
          <p className="student-intro">
            Sign in with your campus account to save your favourites, track pickup tokens in real time, and check out faster.
          </p>
          <div className="guest-action-buttons" style={{ marginTop: '22px' }}>
            <Link to="/login" className="primary-button">
              Sign in <ArrowRight size={15} />
            </Link>
            <Link to="/register" className="text-button">
              Create account <span>→</span>
            </Link>
          </div>
        </section>
      </main>
    )
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')
    try {
      await a.updateProfile(name, studentId)
      setSaveSuccess('Profile updated successfully!')
      setIsEditing(false)
      setTimeout(() => setSaveSuccess(''), 4000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="student-page">
      <section className="student-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="eyebrow">CAMPUSBITE · STUDENT PROFILE</div>
          {!isEditing && (
            <button
              onClick={() => {
                setName(a.profile?.full_name || '')
                setStudentId(a.profile?.student_id || '')
                setIsEditing(true)
              }}
              className="text-button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                background: 'none',
                border: 0,
              }}
            >
              <Edit3 size={14} />
              <span>Edit Profile</span>
            </button>
          )}
        </div>

        <div className="profile-user-summary" style={{ margin: '18px 0 24px' }}>
          <div className="profile-avatar">
            {a.profile?.full_name
              ? a.profile.full_name
                  .split(' ')
                  .map(n => n[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()
              : 'CB'}
          </div>
          <div className="profile-user-details">
            <h2 style={{ margin: 0, fontSize: '22px', color: '#0f172a' }}>
              {a.profile?.full_name || 'Campus Student'}
            </h2>
            <p style={{ margin: '4px 0', fontSize: '13px', color: '#64748b' }}>
              {a.user.email}
            </p>
            <span className="profile-student-id">
              Roll No: {a.profile?.student_id || 'Not registered'}
            </span>
          </div>
          <span className="profile-role-pill">{a.profile?.role || 'student'}</span>
        </div>

        {saveSuccess && <p className="inline-success">{saveSuccess}</p>}
        {saveError && <p className="inline-alert">{saveError}</p>}
        {a.profileError && <p className="inline-alert">{a.profileError}</p>}

        {isEditing ? (
          <form onSubmit={handleSave} className="student-form" style={{ marginTop: '16px' }}>
            <label>
              Full Name
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="e.g. Madhav Sharma"
              />
            </label>
            <label>
              Student ID / Roll No.
              <input
                value={studentId}
                onChange={e => setStudentId(e.target.value)}
                placeholder="e.g. 2026CS101"
              />
            </label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ background: '#f1f5f9', color: '#334155' }}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="profile-list" style={{ borderTop: '1px solid #f1f5f9', paddingTop: '18px' }}>
            <dt>Full Name</dt>
            <dd>{a.profile?.full_name || '—'}</dd>
            <dt>Campus Email</dt>
            <dd>{a.user.email}</dd>
            <dt>Student ID / Roll</dt>
            <dd>{a.profile?.student_id || 'Not registered'}</dd>
            <dt>Campus Role</dt>
            <dd>
              <span className="status-pill status-ready">{a.profile?.role || 'student'}</span>
            </dd>
            <dt>Account Status</dt>
            <dd>{a.profile?.account_status || 'active'}</dd>
          </dl>
        )}

        <div className="profile-quick-actions" style={{ marginTop: '24px' }}>
          <button
            onClick={() => {
              setName(a.profile?.full_name || '')
              setStudentId(a.profile?.student_id || '')
              setIsEditing(!isEditing)
            }}
            className="profile-action-btn"
            style={{ cursor: 'pointer', border: 0 }}
          >
            <Edit3 size={15} />
            <span>{isEditing ? 'Close Edit' : 'Edit Profile'}</span>
          </button>
          <Link to="/orders" className="profile-action-btn secondary">
            <ShoppingBag size={16} />
            <span>View My Orders</span>
          </Link>
          <Link to="/menu" className="profile-action-btn secondary">
            <Utensils size={15} />
            <span>Browse Menu</span>
          </Link>
          <button
            onClick={() => void a.refreshProfile()}
            className="profile-action-btn secondary"
            style={{ cursor: 'pointer', border: 0 }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => void a.signOut()}
            className="profile-signout-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      </section>
    </main>
  )
}

export function CartPage({
  items,
  cart,
  update,
}: {
  items: MenuItem[]
  cart: Record<string, number>
  update: (id: string | number, delta: number) => void
}) {
  const chosen = items.filter(i => (cart[i.id] ?? 0) > 0)
  const stale = Object.entries(cart).filter(
    ([id, count]) => count > 0 && !items.some(item => String(item.id) === id)
  )
  const total = chosen.reduce((n, i) => n + i.price_paise * cart[i.id], 0)

  return (
    <Card title="Your Cart">
      {chosen.length === 0 && stale.length === 0 ? (
        <div className="cart-empty-student">
          <p className="student-intro">Your bag is empty. Explore the menu to add something.</p>
          <Link className="primary-button" to="/menu">
            Browse menu
          </Link>
        </div>
      ) : (
        <>
          <div className="student-cart-lines">
            {chosen.map(i => (
              <div className="student-cart-row" key={i.id}>
                <span>{i.tag}</span>
                <div>
                  <strong>
                    <FssaiVegSymbol /> {i.name}
                  </strong>
                </div>
                <span>₹{(i.price_paise / 100).toFixed(0)}</span>
                <div className="stepper-box">
                  <button onClick={() => update(i.id, -1)} aria-label={`Remove one ${i.name}`}>
                    −
                  </button>
                  <span>{cart[i.id]}</span>
                  <button onClick={() => update(i.id, 1)} aria-label={`Add one ${i.name}`}>
                    +
                  </button>
                </div>
              </div>
            ))}
            {stale.map(([id, count]) => (
              <div className="student-cart-row" key={id}>
                <span>⚠️</span>
                <strong>Item no longer on active menu</strong>
                <span>Unavailable</span>
                <button onClick={() => update(id, -count)}>Remove</button>
              </div>
            ))}
          </div>

          <div className="student-total">
            <span>Estimated subtotal</span>
            <strong>₹{(total / 100).toFixed(0)}</strong>
          </div>

          {chosen.length > 0 && (
            <Link className="primary-button full-width" to="/checkout">
              Proceed to checkout <ChevronRight size={16} />
            </Link>
          )}
        </>
      )}
      <p className="sample-note">
        The server checks current availability and prices when you place the order.
      </p>
    </Card>
  )
}

export function CheckoutPage({
  items,
  cart,
  clearCart,
}: {
  items: MenuItem[]
  cart: Record<string, number>
  clearCart: () => void
}) {
  const a = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const lines = useMemo(() => items.filter(item => (cart[item.id] ?? 0) > 0), [items, cart])
  const hasSampleIds = lines.some(
    item => typeof item.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.id)
  )
  const hasStaleItems = Object.entries(cart).some(
    ([id, count]) => count > 0 && !items.some(item => String(item.id) === id)
  )

  if (!a.user || !a.session) return <Navigate to="/login" state={{ from: '/checkout' }} replace />
  if (lines.length === 0) return <Navigate to="/cart" replace />

  const total = lines.reduce((sum, item) => sum + item.price_paise * cart[item.id], 0)
  const paymentLines = () => lines.map(item => ({ menu_item_id: item.id, quantity: cart[item.id] }))

  const placeOrder = async () => {
    setBusy(true)
    setError('')
    try {
      const key = 'campusbite-order-request'
      let requestId = sessionStorage.getItem(key)
      if (!requestId) {
        requestId = crypto.randomUUID()
        sessionStorage.setItem(key, requestId)
      }
      const order: Order = await apiRequest('/api/orders', a.session!.access_token, {
        method: 'POST',
        body: JSON.stringify({
          items: paymentLines(),
          payment_method: 'pay_at_pickup',
          client_request_id: requestId,
        }),
      })
      sessionStorage.removeItem(key)
      clearCart()
      navigate(`/orders/${order.id}`, { state: { placed: true } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place this order.')
    } finally {
      setBusy(false)
    }
  }

  const payOnline = async () => {
    setBusy(true)
    setError('')
    try {
      const key = 'campusbite-online-order-request'
      let requestId = sessionStorage.getItem(key)
      if (!requestId) {
        requestId = crypto.randomUUID()
        sessionStorage.setItem(key, requestId)
      }
      const intent = (await apiRequest('/api/payments/orders', a.session!.access_token, {
        method: 'POST',
        body: JSON.stringify({ items: paymentLines(), client_request_id: requestId }),
      })) as {
        order_id: string
        amount_paise: number
        currency: string
        razorpay_order_id: string
        key_id: string
      }

      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://checkout.razorpay.com/v1/checkout.js'
          s.onload = () => resolve()
          s.onerror = () => reject(new Error('Could not load Razorpay checkout script.'))
          document.body.appendChild(s)
        })
      }
      if (!window.Razorpay) throw new Error('Razorpay checkout is unavailable.')

      const checkout = new window.Razorpay({
        key: intent.key_id,
        amount: intent.amount_paise,
        currency: intent.currency,
        name: 'CampusBite Canteen',
        description: 'Campus canteen order',
        order_id: intent.razorpay_order_id,
        handler: async (result: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }) => {
          try {
            await apiRequest('/api/payments/verify', a.session!.access_token, {
              method: 'POST',
              body: JSON.stringify({ ...result, order_id: intent.order_id }),
            })
            sessionStorage.removeItem(key)
            clearCart()
            navigate(`/orders/${intent.order_id}`, { state: { placed: true } })
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : 'Payment verification is pending. Check your order status before retrying.'
            )
          }
        },
        modal: { ondismiss: () => setBusy(false) },
        prefill: {
          name: a.profile?.full_name ?? '',
          email: a.user?.email ?? '',
        },
        theme: { color: '#273b2e' },
      })
      checkout.open()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not initialize online payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Review your order">
      <p className="student-intro">
        Choose how you’d like to pay. We’ll confirm your order and prepare it after checkout.
      </p>

      {hasSampleIds && (
        <p className="inline-alert">
          Development menu active. Connect the database-backed menu before placing an order.
        </p>
      )}
      {hasStaleItems && (
        <p className="inline-alert">
          Some cart items are no longer available. Please return to the cart and update it.
        </p>
      )}
      {error && <p className="inline-alert">{error}</p>}

      <div className="student-cart-lines">
        {lines.map(i => (
          <div className="student-cart-row" key={i.id}>
            <span>{i.tag}</span>
            <div>
              <strong>
                <FssaiVegSymbol /> {i.name} × {cart[i.id]}
              </strong>
            </div>
            <span>₹{((i.price_paise * cart[i.id]) / 100).toFixed(0)}</span>
            <span>{i.is_available ? 'Available' : 'Unavailable'}</span>
          </div>
        ))}
      </div>

      <div className="student-total">
        <span>Estimated total</span>
        <strong>₹{(total / 100).toFixed(0)}</strong>
      </div>

      <div className="checkout-action-stack">
        <button
          className="primary-button"
          disabled={busy || hasSampleIds || hasStaleItems || lines.some(i => !i.is_available)}
          onClick={() => void placeOrder()}
        >
          {busy ? 'Placing order…' : 'Place order · Pay at pickup'}
        </button>

        <button
          className="primary-button online-btn"
          disabled={busy || hasSampleIds || hasStaleItems || lines.some(i => !i.is_available)}
          onClick={() => void payOnline()}
        >
          {busy ? 'Opening checkout…' : 'Pay online with Razorpay'}
        </button>
      </div>

      <p className="sample-note">
        The final price is calculated by the server. Online payment is confirmed after the payment gateway verification.
      </p>
    </Card>
  )
}

export function OrdersPage() {
  const a = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!a.session) return
    let active = true
    const load = () =>
      apiRequest('/api/orders', a.session!.access_token)
        .then(rows => {
          if (active) {
            setOrders(rows)
            setError('')
          }
        })
        .catch(e => {
          if (active) setError(e.message)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    void load()

    let channel: any
    let subscribed = false
    let timer: number
    if (supabase) {
      void supabase.realtime.setAuth(a.session.access_token)
      channel = supabase
        .channel(`student-orders-${a.user?.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void load())
        .subscribe(state => {
          subscribed = state === 'SUBSCRIBED'
        })
      timer = window.setInterval(() => {
        if (!subscribed || !navigator.onLine) void load()
      }, 5000)
    } else {
      timer = window.setInterval(() => void load(), 15000)
    }

    const onResume = () => void load()
    window.addEventListener('online', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', onResume)
      document.removeEventListener('visibilitychange', onResume)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [a.session, a.user?.id])

  if (!a.user) return <Navigate to="/login" state={{ from: '/orders' }} replace />

  return (
    <Card title="My orders">
      {loading ? (
        <p className="student-intro">Loading your orders…</p>
      ) : error ? (
        <p className="inline-alert">{error}</p>
      ) : orders.length === 0 ? (
        <div className="cart-empty-student">
          <p className="student-intro">You haven’t placed any orders yet.</p>
          <Link className="primary-button" to="/menu">
            Browse menu
          </Link>
        </div>
      ) : (
        <div className="student-cart-lines">
          {orders.map(order => (
            <div className="order-summary-card" key={order.id}>
              <div className="order-summary-header">
                <div>
                  <span className="order-token-badge">TOKEN #{order.token_number}</span>
                  <small>{new Date(order.created_at).toLocaleString()}</small>
                </div>
                <span className={`status-pill status-${order.status}`}>{order.status}</span>
              </div>
              <div className="order-summary-items">
                {order.items?.map(item => (
                  <div key={item.id}>
                    <span>
                      <FssaiVegSymbol /> {item.quantity} × {item.item_name}
                    </span>
                    <span>₹{(item.line_total_paise / 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
              <div className="order-summary-footer">
                <span>
                  {order.payment_method === 'pay_at_pickup' ? 'Pay at pickup' : `Online · ${order.payment_status}`}
                </span>
                <Link to={`/orders/${order.id}`} className="view-tracking-link">
                  Track status <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function TrackingPage() {
  const { orderId } = useParams()
  const a = useAuth()
  const location = useLocation()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!a.session || !orderId) return
    try {
      setOrder(await apiRequest(`/api/orders/${orderId}`, a.session.access_token))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load order tracking.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!a.session || !orderId) return
    let active = true
    let channel: any
    let subscribed = false
    const refresh = () => {
      if (active) void load()
    }
    void load()

    let timer: number
    if (supabase) {
      void supabase.realtime.setAuth(a.session.access_token)
      channel = supabase
        .channel(`student-order-${orderId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, refresh)
        .subscribe(state => {
          subscribed = state === 'SUBSCRIBED'
        })
      timer = window.setInterval(() => {
        if (!subscribed || !navigator.onLine) refresh()
      }, 5000)
    } else {
      timer = window.setInterval(refresh, 15000)
    }

    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [a.session, orderId])

  if (!a.user) return <Navigate to="/login" state={{ from: `/orders/${orderId}` }} replace />

  const cancel = async () => {
    if (!orderId || !a.session) return
    setBusy(true)
    try {
      setOrder(
        await apiRequest(`/api/orders/${orderId}/transitions`, a.session.access_token, {
          method: 'POST',
          body: JSON.stringify({ next_status: 'cancelled' }),
        })
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel order.')
    } finally {
      setBusy(false)
    }
  }

  const steps = ['placed', 'accepted', 'preparing', 'ready', 'collected']
  const currentStepIndex = order ? steps.indexOf(order.status) : 0

  return (
    <Card title="Order status">
      {(location.state as { placed?: boolean } | null)?.placed && (
        <p className="inline-success">Your order was placed successfully.</p>
      )}

      {loading ? (
        <p className="student-intro">Connecting to live order tracker…</p>
      ) : error ? (
        <p className="inline-alert">{error}</p>
      ) : (
        order && (
          <>
            <div className="token-display-hero">
              <span className="token-label">PICKUP TOKEN</span>
              <strong className="token-big">#{order.token_number}</strong>
              <small>Show this token at the counter when ready</small>
            </div>

            <div className="status-timeline-container">
              {steps.map((st, idx) => {
                const isPassed = currentStepIndex >= idx && order.status !== 'declined' && order.status !== 'cancelled'
                const isCurrent = order.status === st
                return (
                  <div key={st} className={`timeline-step ${isPassed ? 'passed' : ''} ${isCurrent ? 'current' : ''}`}>
                    <div className="step-circle">{isPassed ? '✓' : idx + 1}</div>
                    <span className="step-label">{st}</span>
                  </div>
                )
              })}
            </div>

            {order.status === 'declined' && (
              <p className="inline-alert">This order was declined. Reason: {order.decline_reason || 'No reason provided'}.</p>
            )}
            {order.status === 'cancelled' && <p className="inline-alert">This order has been cancelled.</p>}

            <dl className="profile-list">
              <dt>Status</dt>
              <dd>
                <span className={`status-pill status-${order.status}`}>{order.status}</span>
              </dd>
              <dt>Payment</dt>
              <dd>
                {order.payment_method === 'pay_at_pickup'
                  ? 'Pay at counter'
                  : `Online · ${order.payment_status.toUpperCase()}`}
              </dd>
              <dt>Total</dt>
              <dd>₹{(order.total_paise / 100).toFixed(2)}</dd>
              <dt>Placed</dt>
              <dd>{new Date(order.created_at).toLocaleString()}</dd>
            </dl>

            <div className="ordered-items-box">
              <h3>Items in this order</h3>
              {order.items.map(item => (
                <div className="order-item-line" key={item.id}>
                  <span>
                    <FssaiVegSymbol /> {item.item_name} × {item.quantity}
                  </span>
                  <strong>₹{(item.line_total_paise / 100).toFixed(2)}</strong>
                </div>
              ))}
            </div>

            {order.status === 'placed' && (
              <div className="cancel-order-box">
                <button className="text-button cancel-btn" disabled={busy} onClick={() => void cancel()}>
                  {busy ? 'Cancelling…' : 'Cancel order'}
                </button>
                <small>Orders can only be cancelled while in 'placed' status before staff acceptance.</small>
              </div>
            )}
          </>
        )
      )}
      <p>
        <Link to="/orders">← Back to my orders</Link>
      </p>
    </Card>
  )
}
