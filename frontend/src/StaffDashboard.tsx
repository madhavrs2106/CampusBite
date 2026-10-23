import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, Plus, RefreshCw, RotateCcw, Trash2, Utensils } from 'lucide-react'

import { supabase, useAuth } from './auth'
import { FssaiVegSymbol } from './App'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type OrderLine = {
  id: string
  item_name: string
  quantity: number
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
  items: OrderLine[]
}

type Category = {
  id: string
  name: string
  is_active: boolean
}

type MenuItem = {
  id: string
  name: string
  description: string
  price_paise: number
  is_available: boolean
  is_active: boolean
  is_vegetarian?: boolean
  contains_egg?: boolean
  ingredients_verified?: boolean
  category_id: string | null
  categories?: { name: string } | null
}

async function api(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.detail ?? 'The request failed.')
  return data
}

export default function StaffDashboard() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'orders' | 'menu'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [declining, setDeclining] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [showDeleteStaffModal, setShowDeleteStaffModal] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState(false)
  const [deleteStaffError, setDeleteStaffError] = useState('')

  const confirmDeleteStaff = async () => {
    setDeletingStaff(true)
    setDeleteStaffError('')
    try {
      await auth.deleteProfile()
      setShowDeleteStaffModal(false)
      navigate('/login', {
        replace: true,
        state: {
          notice:
            'Your Canteen Staff profile and account have been permanently deleted. You have been signed out.',
        },
      })
    } catch (err) {
      setDeleteStaffError(err instanceof Error ? err.message : 'Could not delete staff profile.')
      setDeletingStaff(false)
    }
  }

  const token = auth.session?.access_token || 'demo-staff-token'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [orderRows, menuRows, categoryRows] = await Promise.all([
        api('/api/orders', token),
        api('/api/staff/menu', token),
        api('/api/staff/categories', token),
      ])
      setOrders(orderRows)
      setMenu(menuRows)
      setCategories(categoryRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load canteen data.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!token || !auth.user) return
    let active = true
    let subscribed = false
    const refresh = () => {
      if (active && navigator.onLine) void api('/api/orders', token).then(setOrders).catch(() => {})
    }
    let channel: any
    let timer: number
    if (supabase && auth.session) {
      void supabase.realtime.setAuth(token)
      channel = supabase
        .channel(`staff-orders-${auth.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
        .subscribe(state => {
          subscribed = state === 'SUBSCRIBED'
        })
      timer = window.setInterval(() => {
        if (!subscribed) refresh()
      }, 5000)
    } else {
      timer = window.setInterval(refresh, 10000)
    }
    window.addEventListener('online', refresh)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [token, auth.user, auth.session])

  if (auth.loading) {
    return (
      <main className="student-page">
        <p>Loading canteen kitchen…</p>
      </main>
    )
  }

  // If user is not logged in, offer 1-click Demo Staff Mode or Login
  if (!auth.user && (!auth.profile || auth.profile.role !== 'canteen_staff')) {
    return (
      <main className="student-page">
        <section className="student-card">
          <div className="eyebrow">CAMPUSBITE · CANTEEN KITCHEN</div>
          <h1>Canteen Kitchen Access</h1>
          <p className="student-intro">
            Welcome to the Canteen Management Portal. Here you can accept live student orders, update kitchen preparation states, and toggle menu item availability.
          </p>

          <div style={{ margin: '24px 0', padding: '20px', background: 'var(--card-bg, #fff)', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '17px', color: '#ea580c' }}>
              ⚡ Launch Canteen Staff Mode
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: '14px', color: '#64748b', lineHeight: '1.5' }}>
              Test the kitchen dashboard in local mode immediately without needing to log in.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                className="primary-button"
                onClick={async () => {
                  await auth.setRole('canteen_staff')
                  void load()
                }}
              >
                Enter Canteen Staff Mode
              </button>
              <Link to="/login" state={{ from: '/staff' }} className="text-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Sign in to Account <span>→</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
    )
  }

  // If logged in as student or faculty, deny kitchen access
  if (auth.profile && !['canteen_staff', 'admin'].includes(auth.profile.role)) {
    return (
      <main className="student-page">
        <section className="student-card">
          <div className="eyebrow">CAMPUSBITE · ACCESS RESTRICTED</div>
          <h1>Kitchen Access Restricted</h1>
          <p className="student-intro">
            You are signed in as <strong>{auth.profile.full_name || auth.user?.email}</strong> (
            <span className="status-pill status-placed">{auth.profile.role === 'faculty' ? 'Faculty' : 'Student'}</span>).
          </p>

          <div style={{ margin: '22px 0', padding: '18px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <h3 style={{ margin: '0 0 8px', color: '#334155', fontSize: '16px' }}>Canteen Staff Only</h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#64748b', lineHeight: '1.5' }}>
              The Kitchen Dashboard is reserved for authorized canteen personnel. Student and Faculty accounts do not have access to kitchen management.
            </p>
            <Link to="/menu" className="primary-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              Back to Menu
            </Link>
          </div>
        </section>
      </main>
    )
  }


  const updateOrder = async (order: Order, nextStatus: string, reason?: string) => {
    setBusy(order.id)
    setError('')
    setSuccess('')
    try {
      const updated = await api(`/api/orders/${order.id}/transitions`, token, {
        method: 'POST',
        body: JSON.stringify({ next_status: nextStatus, decline_reason: reason }),
      })
      setOrders(current => current.map(row => (row.id === updated.id ? updated : row)))
      setDeclining('')
      setDeclineReason('')
      setSuccess(`Order #${order.token_number} transitioned to ${updated.status}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update order.')
    } finally {
      setBusy('')
    }
  }

  const saveMenu = async (item: MenuItem, payload: Partial<MenuItem>) => {
    setBusy(item.id)
    setError('')
    setSuccess('')
    try {
      const updated = await api(`/api/staff/menu/${item.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setMenu(current => current.map(row => (row.id === updated.id ? updated : row)))
      setSuccess(`${updated.name} updated.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save menu item.')
    } finally {
      setBusy('')
    }
  }

  const addMenu = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const name = String(f.get('name')).trim()
    const price = Number(f.get('price'))
    const verified = f.get('ingredients_verified') === 'on'

    if (!name || !Number.isFinite(price) || price < 0) {
      setError('Please provide a valid name and price.')
      return
    }

    setBusy('new-menu')
    setError('')
    setSuccess('')
    try {
      const added = await api('/api/staff/menu', token, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: String(f.get('description')).trim(),
          price_paise: Math.round(price * 100),
          category_id: String(f.get('category_id')) || null,
          is_vegetarian: true,
          contains_egg: false,
          ingredients_verified: verified,
          is_available: verified,
          is_active: true,
        }),
      })
      setMenu(current => [...current, added].sort((a, b) => a.name.localeCompare(b.name)))
      form.reset()
      setSuccess(`${added.name} successfully added to the menu.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add menu item.')
    } finally {
      setBusy('')
    }
  }

  const activeOrders = orders.filter(o => ['placed', 'accepted', 'preparing', 'ready'].includes(o.status))
  const history = orders.filter(o => !['placed', 'accepted', 'preparing', 'ready'].includes(o.status))

  return (
    <main className="staff-shell">
      <div className="staff-heading">
        <div>
          <div className="eyebrow">CAMPUSBITE · CANTEEN</div>
          <h1>
            Kitchen Dashboard, {(auth.profile?.full_name || 'Staff').split(' ')[0]}
            <span>.</span>
          </h1>
          <p>
            Manage live pickup queues and keep today’s menu current.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="status-pill status-ready" style={{ textTransform: 'capitalize' }}>
            {auth.profile?.role || 'Staff'}
          </span>
          <button
            className="staff-refresh"
            style={{ fontSize: '12px', padding: '6px 10px' }}
            onClick={async () => {
              await auth.setRole('student')
            }}
            title="Switch back to student view"
          >
            Exit Staff Mode
          </button>
          <button className="staff-refresh" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            className="staff-refresh"
            style={{ fontSize: '12px', padding: '6px 10px', color: '#b91c1c', borderColor: '#fca5a5', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            onClick={async () => {
              if (!window.confirm('Empty all localhost trial orders and reset menu items for a fresh start?')) return
              try {
                await fetch(`${apiUrl}/api/dev/reset`, { method: 'POST' })
                localStorage.removeItem('campusbite-cart')
                await load()
                setSuccess('Localhost database cleaned! Orders reset to 0 and all items set to available.')
              } catch {
                setError('Could not reset database.')
              }
            }}
            title="Clean/Empty database for a fresh trial"
          >
            <RotateCcw size={14} />
            Reset Trial Data
          </button>
          <button
            className="staff-refresh"
            style={{
              fontSize: '12px',
              padding: '6px 10px',
              color: '#b91c1c',
              borderColor: '#fca5a5',
              background: '#fef2f2',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => setShowDeleteStaffModal(true)}
            title="Delete Canteen User Profile"
          >
            <Trash2 size={14} />
            Delete Profile
          </button>
        </div>
      </div>


      <div className="staff-tabs">
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          <Clock3 size={17} /> Live Order Queue <b>{activeOrders.length}</b>
        </button>
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
          <Utensils size={17} /> Menu Management <b>{menu.length}</b>
        </button>
      </div>

      {error && (
        <div className="staff-alert error">
          <CircleAlert size={17} />
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {success && (
        <div className="staff-alert success">
          <Check size={17} />
          {success}
          <button onClick={() => setSuccess('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="staff-loading">
          <LoaderCircle className="spin" /> Loading canteen data…
        </div>
      ) : tab === 'orders' ? (
        <section className="staff-content">
          <div className="staff-section-title">
            <div>
              <span className="eyebrow">LIVE KITCHEN QUEUE</span>
              <h2>Active Orders to Prepare</h2>
            </div>
            <span className="staff-count">{activeOrders.length} active orders</span>
          </div>

          {activeOrders.length === 0 ? (
            <div className="staff-empty">
              <span>☕</span>
              <h3>All caught up</h3>
              <p>New orders will appear here in real time.</p>
            </div>
          ) : (
            <div className="staff-order-grid">
              {activeOrders.map(order => (
                <article className="staff-order-card" key={order.id}>
                  <header>
                    <div>
                      <span className="staff-token">TOKEN #{order.token_number}</span>
                      <small>{new Date(order.created_at).toLocaleTimeString()}</small>
                    </div>
                    <span className={`status-pill status-${order.status}`}>{order.status}</span>
                  </header>

                  <div className="staff-order-items">
                    {order.items.map(line => (
                      <div key={line.id}>
                        <span>
                          <FssaiVegSymbol /> {line.quantity} × {line.item_name}
                        </span>
                        <strong>₹{(line.line_total_paise / 100).toFixed(0)}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="staff-order-total">
                    <span>
                      {order.payment_method === 'pay_at_pickup'
                        ? 'Pay at Pickup'
                        : `Online · ${order.payment_status.toUpperCase()}`}
                    </span>
                    <strong>₹{(order.total_paise / 100).toFixed(0)}</strong>
                  </div>

                  {order.status === 'placed' && (
                    <div className="staff-actions">
                      {declining === order.id ? (
                        <form
                          className="decline-form"
                          onSubmit={e => {
                            e.preventDefault()
                            if (declineReason.trim()) void updateOrder(order, 'declined', declineReason.trim())
                          }}
                        >
                          <input
                            value={declineReason}
                            onChange={e => setDeclineReason(e.target.value)}
                            placeholder="Reason for declining order"
                            required
                            maxLength={500}
                          />
                          <button type="submit" disabled={busy === order.id || !declineReason.trim()}>
                            Confirm decline
                          </button>
                          <button
                            type="button"
                            className="cancel-decline"
                            onClick={() => {
                              setDeclining('')
                              setDeclineReason('')
                            }}
                          >
                            Keep order
                          </button>
                        </form>
                      ) : (
                        <>
                          {order.payment_method === 'online' && order.payment_status !== 'paid' ? (
                            <p className="payment-hold">Awaiting online payment confirmation</p>
                          ) : (
                            <button
                              className="staff-primary"
                              disabled={busy === order.id}
                              onClick={() => void updateOrder(order, 'accepted')}
                            >
                              Accept order <ChevronRight size={15} />
                            </button>
                          )}
                          <button
                            className="staff-decline"
                            disabled={busy === order.id}
                            onClick={() => {
                              setDeclining(order.id)
                              setDeclineReason('')
                            }}
                          >
                            Decline
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {order.status === 'accepted' && (
                    <button
                      className="staff-primary full"
                      disabled={busy === order.id}
                      onClick={() => void updateOrder(order, 'preparing')}
                    >
                      Start preparing <ChevronRight size={15} />
                    </button>
                  )}

                  {order.status === 'preparing' && (
                    <button
                      className="staff-primary full"
                      disabled={busy === order.id}
                      onClick={() => void updateOrder(order, 'ready')}
                    >
                      Mark ready for pickup <Check size={15} />
                    </button>
                  )}

                  {order.status === 'ready' && (
                    <button
                      className="staff-primary full"
                      disabled={busy === order.id}
                      onClick={() => void updateOrder(order, 'collected')}
                    >
                      Confirm handed over / collected <Check size={15} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <details className="staff-history">
              <summary>
                Completed &amp; Past Orders <span>{history.length}</span>
              </summary>
              <div>
                {history.slice(0, 30).map(order => (
                  <div key={order.id}>
                    <strong>#{order.token_number}</strong>
                    <span>{order.status}</span>
                    <span>₹{(order.total_paise / 100).toFixed(0)}</span>
                    <time>{new Date(order.created_at).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      ) : (
        <section className="staff-content">
          <div className="staff-section-title">
            <div>
              <span className="eyebrow">CATALOG</span>
              <h2>Menu Items &amp; Availability</h2>
            </div>
          </div>

          <form className="add-menu-form" onSubmit={e => void addMenu(e)}>
            <h3>
              <Plus size={17} /> Add Menu Item
            </h3>
            <div className="add-menu-fields">
              <label>
                Dish Name
                <input name="name" required maxLength={120} placeholder="e.g. Masala Dosa, Veg Momos" />
              </label>
              <label>
                Description / Ingredients
                <input name="description" maxLength={1000} placeholder="Ingredients and details" />
              </label>
              <label>
                Price (₹)
                <input name="price" type="number" min="0" step="0.01" required placeholder="60.00" />
              </label>
              <label>
                Category
                <select name="category_id" defaultValue="">
                  <option value="">Select category</option>
                  {categories
                    .filter(c => c.is_active)
                    .map(c => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="veg-verification-toggle">
              <label className="checkbox-label">
                <input type="checkbox" name="ingredients_verified" defaultChecked />
                <span>
                  <strong>✓ Recipe ingredients verified</strong>
                </span>
              </label>
            </div>

            <button className="staff-primary" disabled={busy === 'new-menu'}>
              {busy === 'new-menu' ? 'Adding to menu…' : 'Add Item'}
            </button>
          </form>

          <div className="staff-menu-list">
            {menu.map(item => (
              <MenuEditor key={item.id} item={item} categories={categories} busy={busy === item.id} save={saveMenu} />
            ))}
          </div>

          {menu.length === 0 && (
            <div className="staff-empty">
              <h3>No items in the menu</h3>
              <p>Use the form above to add your first menu item.</p>
            </div>
          )}
        </section>
      )}

      <section
        style={{
          marginTop: '32px',
          padding: '20px 24px',
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #fee2e2',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <span className="eyebrow" style={{ color: '#b91c1c' }}>CANTEEN ACCOUNT · DANGER ZONE</span>
          <h3 style={{ margin: '4px 0 2px', fontSize: '16px', color: '#0f172a' }}>
            Delete Canteen User Profile
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            Logged in as <strong>{auth.profile?.full_name || 'Staff User'}</strong> ({auth.user?.email || 'canteen staff'}).
            Permanently delete your profile, role permissions, and canteen records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDeleteStaffModal(true)}
          style={{
            padding: '9px 18px',
            borderRadius: '8px',
            background: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fecaca',
            fontWeight: 600,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Trash2 size={15} />
          <span>Delete Profile</span>
        </button>
      </section>

      {showDeleteStaffModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
              border: '1px solid #fee2e2',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a', fontWeight: 700 }}>
                  Are you sure you want to delete?
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>
                  Permanent Canteen Profile Deletion
                </p>
              </div>
            </div>

            {deleteStaffError && (
              <p className="inline-alert" style={{ marginBottom: '14px' }}>
                {deleteStaffError}
              </p>
            )}

            <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.5', margin: '0 0 12px' }}>
              Are you sure you want to delete the Canteen Staff profile for{' '}
              <strong>{auth.profile?.full_name || auth.user?.email || 'this canteen user'}</strong>?
            </p>

            <ul style={{ fontSize: '13px', color: '#64748b', margin: '0 0 18px', paddingLeft: '18px', lineHeight: '1.6' }}>
              <li>Your canteen staff session will be terminated immediately</li>
              <li>Kitchen dashboard management permissions will be permanently revoked</li>
              <li>Your account record ({auth.user?.email || 'current user'}) will be removed</li>
            </ul>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteStaffModal(false)
                  setDeleteStaffError('')
                }}
                disabled={deletingStaff}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteStaff()}
                disabled={deletingStaff}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: deletingStaff ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Trash2 size={15} />
                <span>{deletingStaff ? 'Deleting…' : 'Yes, Delete Canteen Profile'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function MenuEditor({
  item,
  categories,
  busy,
  save,
}: {
  item: MenuItem
  categories: Category[]
  busy: boolean
  save: (item: MenuItem, payload: Partial<MenuItem>) => void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description)
  const [price, setPrice] = useState((item.price_paise / 100).toFixed(2))
  const [categoryId, setCategoryId] = useState(item.category_id ?? '')
  const [verified, setVerified] = useState(Boolean(item.ingredients_verified))

  useEffect(() => {
    setName(item.name)
    setDescription(item.description)
    setPrice((item.price_paise / 100).toFixed(2))
    setCategoryId(item.category_id ?? '')
    setVerified(Boolean(item.ingredients_verified))
  }, [item])

  const handleSave = () => {
    save(item, {
      name: name.trim(),
      description: description.trim(),
      price_paise: Math.round(Number(price) * 100),
      category_id: categoryId || null,
      ingredients_verified: verified,
      is_vegetarian: true,
      contains_egg: false,
    })
  }

  return (
    <article className={`menu-editor ${!item.is_active ? 'inactive' : ''}`}>
      <div className="menu-editor-head">
        <div>
          <div className="menu-editor-title">
            <FssaiVegSymbol />
            <strong>{item.name}</strong>
          </div>
          <span>
            {item.categories?.name ?? 'Uncategorized'} · {item.is_active ? 'Active listing' : 'Archived'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => save(item, { is_available: !item.is_available })}
            disabled={busy || !item.is_active}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: item.is_active ? 'pointer' : 'not-allowed',
              border: item.is_available ? '1px solid #16a34a' : '1px solid #dc2626',
              background: item.is_available ? '#dcfce7' : '#fee2e2',
              color: item.is_available ? '#15803d' : '#b91c1c',
              transition: 'all 0.15s ease',
            }}
            title={item.is_available ? 'Click to mark Sold Out' : 'Click to mark Available'}
          >
            {item.is_available ? '● Available' : '○ Sold Out'}
          </button>
        </div>
      </div>


      <div className="menu-edit-fields">
        <label>
          Dish Name
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} />
        </label>
        <label>
          Description / Recipe
          <input value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
        </label>
        <label>
          Price (₹)
          <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} />
        </label>
        <label>
          Category
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories
              .filter(c => c.is_active)
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="veg-item-verification-row">
        <label className="checkbox-label">
          <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
          <span>Recipe ingredients verified</span>
        </label>
        <button
          className="staff-primary"
          disabled={busy || !name.trim() || !Number.isFinite(Number(price))}
          onClick={handleSave}
        >
          {busy ? 'Saving…' : 'Save Details'}
        </button>
      </div>

      <div className="menu-editor-actions">
        <button
          onClick={() => save(item, { is_available: !item.is_available })}
          disabled={busy || !item.is_active || (!item.is_available && !item.ingredients_verified)}
          title={!item.ingredients_verified ? 'Verify ingredients before making available' : ''}
        >
          {item.is_available ? 'Mark sold out' : 'Mark available'}
        </button>
        <button className="archive-action" onClick={() => save(item, { is_active: !item.is_active })} disabled={busy}>
          {item.is_active ? 'Hide from menu' : 'Restore to menu'}
        </button>
      </div>
    </article>
  )
}
