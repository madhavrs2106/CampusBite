import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  BellRing,
  BookOpen,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Coffee,
  Edit3,
  GraduationCap,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  User,
  Utensils,
  X,
} from 'lucide-react'

import { supabase, useAuth } from './auth'
import { FssaiVegSymbol } from './App'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type OrderLine = {
  id: string
  item_name: string
  quantity: number
  unit_price_paise?: number
  line_total_paise: number
}

export type Order = {
  id: string
  token_number: string
  status: string
  payment_method: string
  payment_status: string
  total_paise: number
  created_at: string
  decline_reason?: string | null
  customer_name?: string
  customer_role?: 'student' | 'faculty' | string
  user_role?: 'student' | 'faculty' | string
  customer_id?: string
  notifications_sent?: number
  last_notified_at?: string | null
  items: OrderLine[]
}

export type Category = {
  id: string
  name: string
  is_active: boolean
}

export type MenuItem = {
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
  image_url?: string | null
  tag?: string
  color?: string
  categories?: { name: string } | null
}

export type StaffStats = {
  total_orders: number
  student_orders_count: number
  faculty_orders_count: number
  student_revenue_paise: number
  faculty_revenue_paise: number
  student_active_count: number
  faculty_active_count: number
  student_delivered_count: number
  faculty_delivered_count: number
  status_counts: Record<string, number>
  popular_items: Array<{
    name: string
    total_qty: number
    student_qty: number
    faculty_qty: number
  }>
  today_student_count: number
  today_faculty_count: number
}

const PRESET_FOOD_IMAGES = [
  { name: 'Masala Dosa', tag: '🥞', url: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=600&q=80' },
  { name: 'Poha', tag: '🥣', url: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=600&q=80' },
  { name: 'Paratha', tag: '🫓', url: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=600&q=80' },
  { name: 'Idli Sambar', tag: '🥞', url: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80' },
  { name: 'Veg Sandwich', tag: '🥪', url: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=600&q=80' },
  { name: 'Samosa', tag: '🥟', url: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80' },
  { name: 'Special Thali', tag: '🍱', url: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=600&q=80' },
  { name: 'Masala Chai', tag: '☕', url: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=600&q=80' },
  { name: 'Filter Coffee', tag: '☕', url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80' },
]

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

export type StaffTab = 'home' | 'menu' | 'orders' | 'profile'

export default function StaffDashboard({ initialTab }: { initialTab?: StaffTab }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Determine active tab from props or URL path
  const resolveTabFromPath = (): StaffTab => {
    if (initialTab) return initialTab
    const p = location.pathname.toLowerCase()
    if (p.includes('/menu')) return 'menu'
    if (p.includes('/orders')) return 'orders'
    if (p.includes('/profile')) return 'profile'
    return 'home'
  }

  const [tab, setTab] = useState<StaffTab>(resolveTabFromPath)
  const [orders, setOrders] = useState<Order[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [stats, setStats] = useState<StaffStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [declining, setDeclining] = useState('')
  const [declineReason, setDeclineReason] = useState('')

  // Sub-filters for orders and menu
  const [ordersFilter, setOrdersFilter] = useState<'all' | 'placed' | 'accepted' | 'preparing' | 'ready' | 'collected'>('all')
  const [menuQuery, setMenuQuery] = useState('')
  const [menuCategory, setMenuCategory] = useState('All')
  const [menuAvailabilityFilter, setMenuAvailabilityFilter] = useState<'all' | 'available' | 'sold'>('all')

  // Modals & form states
  const [showAddMenuModal, setShowAddMenuModal] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null)
  const [showDeleteStaffModal, setShowDeleteStaffModal] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState(false)
  const [deleteStaffError, setDeleteStaffError] = useState('')

  // Notification feedback state
  const [notifyingOrderId, setNotifyingOrderId] = useState<string | null>(null)

  // Sync tab with route changes
  useEffect(() => {
    const nextTab = resolveTabFromPath()
    setTab(nextTab)
  }, [location.pathname, initialTab])

  const token = auth.session?.access_token || 'demo-staff-token'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [orderRows, menuRows, categoryRows, statsData] = await Promise.all([
        api('/api/orders', token).catch(() => []),
        api('/api/staff/menu', token).catch(() => []),
        api('/api/staff/categories', token).catch(() => []),
        api('/api/staff/stats', token).catch(() => null),
      ])
      setOrders(orderRows || [])
      setMenu(menuRows || [])
      setCategories(categoryRows || [])
      if (statsData) setStats(statsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load canteen data.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  // Realtime updates
  useEffect(() => {
    if (!token || !auth.user) return
    let active = true
    let subscribed = false
    const refresh = () => {
      if (active && navigator.onLine) {
        void api('/api/orders', token).then(setOrders).catch(() => {})
        void api('/api/staff/stats', token).then(setStats).catch(() => {})
      }
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
      timer = window.setInterval(refresh, 8000)
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

  // 1-Click Launch demo or Restricted notice
  if (!auth.user && (!auth.profile || auth.profile.role !== 'canteen_staff')) {
    return (
      <main className="student-page">
        <section className="student-card">
          <div className="eyebrow">CAMPUSBITE · CANTEEN KITCHEN</div>
          <h1>Canteen Staff Portal</h1>
          <p className="student-intro">
            Welcome to the Canteen Staff Operations Hub. Manage menu availability, oversee live order stages, and track student vs faculty order statistics.
          </p>
          <div style={{ margin: '24px 0', padding: '20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: '#ea580c' }}>
              ⚡ Launch Canteen Staff Mode
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#64748b' }}>
              Experience the full redesigned Canteen Staff Portal instantly in local mode.
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
                Sign in with Staff Account <span>→</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
    )
  }

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
              The Staff Portal is reserved for canteen kitchen and counter operators.
            </p>
            <Link to="/menu" className="primary-button">Back to Menu</Link>
          </div>
        </section>
      </main>
    )
  }

  // Order state transition helper
  const updateOrder = async (order: Order, nextStatus: string, reason?: string) => {
    setBusy(order.id)
    setError('')
    setSuccess('')
    try {
      const updated = await api(`/api/orders/${order.id}/transitions`, token, {
        method: 'POST',
        body: JSON.stringify({ next_status: nextStatus, decline_reason: reason }),
      })
      setOrders(current => current.map(row => (row.id === updated.id ? { ...row, ...updated } : row)))
      setDeclining('')
      setDeclineReason('')

      let statusMsg = ''
      if (nextStatus === 'accepted') statusMsg = `Order #${order.token_number} accepted! Customer notified.`
      else if (nextStatus === 'preparing') statusMsg = `Kitchen started preparing Token #${order.token_number}.`
      else if (nextStatus === 'ready') statusMsg = `🔔 Token #${order.token_number} is DONE & READY! Pickup notification sent to customer.`
      else if (nextStatus === 'collected') statusMsg = `Token #${order.token_number} delivered & billing completed!`
      else statusMsg = `Order #${order.token_number} updated to ${nextStatus}.`

      setSuccess(statusMsg)
      void api('/api/staff/stats', token).then(setStats).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update order.')
    } finally {
      setBusy('')
    }
  }

  // Notification button action for Ready items
  const sendReadyNotification = async (order: Order) => {
    setNotifyingOrderId(order.id)
    setError('')
    try {
      const res = await api(`/api/staff/orders/${order.id}/notify`, token, { method: 'POST' })
      setOrders(current =>
        current.map(row =>
          row.id === order.id
            ? {
                ...row,
                notifications_sent: (row.notifications_sent ?? 0) + 1,
                last_notified_at: res.last_notified_at || new Date().toISOString(),
              }
            : row
        )
      )
      const roleText = order.customer_role === 'faculty' ? 'Faculty Member' : 'Student'
      setSuccess(`🔔 Pickup Reminder sent for Token #${order.token_number} to ${order.customer_name || roleText}! (Notification #${(order.notifications_sent ?? 0) + 1})`)
    } catch {
      // Fallback in-memory
      setOrders(current =>
        current.map(row =>
          row.id === order.id
            ? { ...row, notifications_sent: (row.notifications_sent ?? 0) + 1, last_notified_at: new Date().toISOString() }
            : row
        )
      )
      setSuccess(`🔔 Buzzer reminder sent to Token #${order.token_number}!`)
    } finally {
      setNotifyingOrderId(null)
    }
  }

  // Toggle item availability
  const toggleAvailability = async (item: MenuItem) => {
    setBusy(item.id)
    setError('')
    try {
      const updated = await api(`/api/staff/menu/${item.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ is_available: !item.is_available }),
      })
      setMenu(curr => curr.map(i => (i.id === item.id ? { ...i, is_available: updated.is_available } : i)))
      setSuccess(`${item.name} marked as ${updated.is_available ? 'Available' : 'Sold Out'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update availability.')
    } finally {
      setBusy('')
    }
  }

  // Save edited item details
  const saveMenuItemDetails = async (item: MenuItem, payload: Partial<MenuItem>) => {
    setBusy(item.id)
    setError('')
    setSuccess('')
    try {
      const updated = await api(`/api/staff/menu/${item.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setMenu(curr => curr.map(i => (i.id === item.id ? { ...i, ...updated } : i)))
      setEditingItem(null)
      setSuccess(`${updated.name} details successfully updated.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save menu item.')
    } finally {
      setBusy('')
    }
  }

  // Add new menu item
  const handleAddMenuSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const name = String(f.get('name')).trim()
    const price = Number(f.get('price'))
    const description = String(f.get('description')).trim()
    const category_id = String(f.get('category_id')) || null
    const image_url = String(f.get('image_url')).trim() || null
    const tag = String(f.get('tag')).trim() || '🌱'
    const verified = f.get('ingredients_verified') === 'on'

    if (!name || !Number.isFinite(price) || price < 0) {
      setError('Please provide a valid dish name and price.')
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
          description,
          price_paise: Math.round(price * 100),
          category_id,
          image_url,
          tag,
          color: 'sand',
          is_vegetarian: true,
          contains_egg: false,
          ingredients_verified: verified,
          is_available: verified,
          is_active: true,
        }),
      })
      setMenu(curr => [...curr, added].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAddMenuModal(false)
      form.reset()
      setSuccess(`${added.name} successfully added to the menu!`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add item.')
    } finally {
      setBusy('')
    }
  }

  // Remove menu item
  const confirmDeleteMenuItem = async () => {
    if (!itemToDelete) return
    setBusy(itemToDelete.id)
    setError('')
    try {
      await api(`/api/staff/menu/${itemToDelete.id}`, token, { method: 'DELETE' })
      setMenu(curr => curr.filter(i => i.id !== itemToDelete.id))
      setSuccess(`"${itemToDelete.name}" removed from the menu.`)
      setItemToDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove menu item.')
    } finally {
      setBusy('')
    }
  }

  // Delete staff profile
  const confirmDeleteStaff = async () => {
    setDeletingStaff(true)
    setDeleteStaffError('')
    try {
      await auth.deleteProfile()
      setShowDeleteStaffModal(false)
      navigate('/login', {
        replace: true,
        state: {
          notice: 'Your Canteen Staff profile and account have been deleted. You have been signed out.',
        },
      })
    } catch (err) {
      setDeleteStaffError(err instanceof Error ? err.message : 'Could not delete staff profile.')
      setDeletingStaff(false)
    }
  }

  // Calculated statistics fallback
  const studentOrders = orders.filter(o => (o.customer_role || o.user_role) === 'student')
  const facultyOrders = orders.filter(o => (o.customer_role || o.user_role) === 'faculty')
  const activeOrders = orders.filter(o => ['placed', 'accepted', 'preparing', 'ready'].includes(o.status))
  const deliveredOrders = orders.filter(o => o.status === 'collected')

  const totalOrdersCount = stats?.total_orders ?? orders.length
  const studentCount = stats?.student_orders_count ?? studentOrders.length
  const facultyCount = stats?.faculty_orders_count ?? facultyOrders.length
  const studentRevenue = stats?.student_revenue_paise ?? studentOrders.reduce((s, o) => s + (o.total_paise || 0), 0)
  const facultyRevenue = stats?.faculty_revenue_paise ?? facultyOrders.reduce((s, o) => s + (o.total_paise || 0), 0)

  const studentPercentage = totalOrdersCount > 0 ? Math.round((studentCount / totalOrdersCount) * 100) : 50
  const facultyPercentage = totalOrdersCount > 0 ? 100 - studentPercentage : 50

  // Filtered orders for Orders tab
  const filteredOrders = orders.filter(o => {
    if (ordersFilter === 'all') return ['placed', 'accepted', 'preparing', 'ready'].includes(o.status)
    return o.status === ordersFilter
  })

  // Filtered items for Menu tab
  const menuCategories = ['All', ...Array.from(new Set(categories.map(c => c.name)))]
  const filteredMenuItems = menu.filter(item => {
    const matchesSearch = `${item.name} ${item.description}`.toLowerCase().includes(menuQuery.toLowerCase())
    const catName = item.categories?.name || ''
    const matchesCategory = menuCategory === 'All' || catName === menuCategory
    const matchesAvailability =
      menuAvailabilityFilter === 'all'
        ? true
        : menuAvailabilityFilter === 'available'
        ? item.is_available
        : !item.is_available
    return matchesSearch && matchesCategory && matchesAvailability
  })

  const availableCount = menu.filter(i => i.is_available).length
  const soldOutCount = menu.filter(i => !i.is_available).length

  return (
    <main className="staff-shell staff-redesign-shell">
      {/* Global Staff Status Banner / Top Bar */}
      <div className="staff-top-header">
        <div className="staff-welcome-intro">
          <div className="staff-eyebrow-row">
            <span className="live-dot" />
            <span className="eyebrow" style={{ color: '#c2410c' }}>CAMPUSBITE · CANTEEN STAFF HUB</span>
            <span className="staff-portal-tag">STAFF MODE</span>
          </div>
          <h1 className="staff-title">
            {tab === 'home' && `Welcome, ${(auth.profile?.full_name || 'Staff Member').split(' ')[0]} 👋`}
            {tab === 'menu' && 'Menu Catalog Management'}
            {tab === 'orders' && 'Live Kitchen Orders Queue'}
            {tab === 'profile' && 'Canteen Staff Profile'}
          </h1>
          <p className="staff-subtitle">
            {tab === 'home' && 'Review order statistics for Students & Faculty, and manage kitchen readiness.'}
            {tab === 'menu' && 'Add new dishes, update prices & food images, and toggle availability.'}
            {tab === 'orders' && '4-step workflow: Accept → Kitchen Processing → Mark Done → Hand Over / Delivered.'}
            {tab === 'profile' && 'View your canteen credentials, staff shift details, and operator preferences.'}
          </p>
        </div>

        <div className="staff-header-actions">
          <button
            className="staff-btn-ghost"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh canteen data"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
          <button
            className="staff-btn-ghost danger"
            onClick={async () => {
              if (!window.confirm('Empty trial test orders and restore menu availability?')) return
              try {
                await fetch(`${apiUrl}/api/dev/reset`, { method: 'POST' })
                localStorage.removeItem('campusbite-cart')
                await load()
                setSuccess('Database cleaned! Orders restored and all dishes set to available.')
              } catch {
                setError('Could not reset data.')
              }
            }}
            title="Clean/Reset sample test data"
          >
            <RotateCcw size={14} />
            <span>Reset Trial</span>
          </button>
        </div>
      </div>

      {/* Staff Primary 4-Tab Navigation */}
      <nav className="staff-tabs-nav" aria-label="Staff navigation tabs">
        <button
          className={tab === 'home' ? 'staff-tab-pill active' : 'staff-tab-pill'}
          onClick={() => {
            setTab('home')
            navigate('/staff')
          }}
        >
          <LayoutDashboard size={18} />
          <span>Home</span>
          <span className="staff-tab-badge stats-badge">Stats</span>
        </button>

        <button
          className={tab === 'menu' ? 'staff-tab-pill active' : 'staff-tab-pill'}
          onClick={() => {
            setTab('menu')
            navigate('/staff/menu')
          }}
        >
          <Utensils size={18} />
          <span>Menu</span>
          <span className="staff-tab-badge">{menu.length}</span>
        </button>

        <button
          className={tab === 'orders' ? 'staff-tab-pill active' : 'staff-tab-pill'}
          onClick={() => {
            setTab('orders')
            navigate('/staff/orders')
          }}
        >
          <Clock3 size={18} />
          <span>Orders</span>
          {activeOrders.length > 0 && <span className="staff-tab-badge pulse">{activeOrders.length}</span>}
        </button>

        <button
          className={tab === 'profile' ? 'staff-tab-pill active' : 'staff-tab-pill'}
          onClick={() => {
            setTab('profile')
            navigate('/staff/profile')
          }}
        >
          <User size={18} />
          <span>Profile</span>
        </button>
      </nav>

      {/* Alerts */}
      {error && (
        <div className="staff-alert error" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss">×</button>
        </div>
      )}
      {success && (
        <div className="staff-alert success" role="alert">
          <Check size={18} />
          <span>{success}</span>
          <button onClick={() => setSuccess('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Loading state */}
      {loading && !menu.length && !orders.length ? (
        <div className="staff-loading">
          <LoaderCircle className="spin" size={24} />
          <span>Loading canteen records…</span>
        </div>
      ) : null}

      {/* TAB 1: HOME (Welcome Page with Separate Student & Faculty Statistics, NO Menu) */}
      {tab === 'home' && (
        <section className="staff-view-container staff-home-view">
          {/* Welcome Operational Banner */}
          <div className="staff-welcome-banner">
            <div className="welcome-banner-copy">
              <span className="welcome-badge">
                <Coffee size={14} /> Canteen Operations Ready
              </span>
              <h2>Campus Breaks in Full Swing</h2>
              <p>
                Real-time breakdown of orders placed by <strong>Students</strong> and <strong>Faculty Members</strong>. Use the buttons below for quick kitchen actions.
              </p>
              <div className="welcome-quick-links">
                <button
                  className="primary-button"
                  onClick={() => {
                    setTab('orders')
                    navigate('/staff/orders')
                  }}
                >
                  <Clock3 size={16} /> Open Orders Queue ({activeOrders.length})
                </button>
                <button
                  className="staff-btn-outline"
                  onClick={() => {
                    setTab('menu')
                    navigate('/staff/menu')
                  }}
                >
                  <Utensils size={16} /> Manage Menu Items ({menu.length})
                </button>
              </div>
            </div>
            <div className="welcome-live-status-card">
              <div className="live-status-header">
                <span className="live-dot" />
                <strong>Counter Status</strong>
              </div>
              <p>Online &amp; Counter Orders</p>
              <div className="live-status-numbers">
                <div>
                  <strong>{activeOrders.length}</strong>
                  <small>Active in Kitchen</small>
                </div>
                <div>
                  <strong>{deliveredOrders.length}</strong>
                  <small>Delivered Today</small>
                </div>
              </div>
            </div>
          </div>

          {/* Separate Student & Faculty Statistics Cards */}
          <div className="stats-section-header">
            <div>
              <span className="eyebrow" style={{ color: '#ea580c' }}>SEPARATE CUSTOMER STATISTICS</span>
              <h2>Students &amp; Faculty Orders Breakdown</h2>
            </div>
            <span className="staff-stats-total-pill">Total {totalOrdersCount} Orders Recorded</span>
          </div>

          <div className="staff-stats-dual-grid">
            {/* 1. Students Statistics Card */}
            <article className="stat-card student-stat-card">
              <div className="stat-card-header">
                <div className="stat-icon-wrap student-icon">
                  <GraduationCap size={24} />
                </div>
                <div className="stat-card-title">
                  <span className="stat-role-pill student">STUDENT ORDERS</span>
                  <h3>Students</h3>
                </div>
              </div>

              <div className="stat-main-metric">
                <strong className="stat-big-number">{studentCount}</strong>
                <span className="stat-unit">total orders placed</span>
              </div>

              <div className="stat-metrics-subgrid">
                <div className="sub-metric">
                  <span className="sub-metric-label">Revenue from Students</span>
                  <strong className="sub-metric-value">₹{(studentRevenue / 100).toFixed(0)}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">In-Kitchen Active</span>
                  <strong className="sub-metric-value">{studentOrders.filter(o => ['placed', 'accepted', 'preparing', 'ready'].includes(o.status)).length}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">Delivered &amp; Billed</span>
                  <strong className="sub-metric-value">{studentOrders.filter(o => o.status === 'collected').length}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">Share of Total Orders</span>
                  <strong className="sub-metric-value">{studentPercentage}%</strong>
                </div>
              </div>

              <div className="stat-footer-bar">
                <span className="stat-footer-note">
                  <BookOpen size={13} /> Roll numbers &amp; token IDs tracked
                </span>
              </div>
            </article>

            {/* 2. Faculty Members Statistics Card */}
            <article className="stat-card faculty-stat-card">
              <div className="stat-card-header">
                <div className="stat-icon-wrap faculty-icon">
                  <Briefcase size={24} />
                </div>
                <div className="stat-card-title">
                  <span className="stat-role-pill faculty">FACULTY ORDERS</span>
                  <h3>Faculty &amp; Professors</h3>
                </div>
              </div>

              <div className="stat-main-metric">
                <strong className="stat-big-number">{facultyCount}</strong>
                <span className="stat-unit">total orders placed</span>
              </div>

              <div className="stat-metrics-subgrid">
                <div className="sub-metric">
                  <span className="sub-metric-label">Revenue from Faculty</span>
                  <strong className="sub-metric-value">₹{(facultyRevenue / 100).toFixed(0)}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">In-Kitchen Active</span>
                  <strong className="sub-metric-value">{facultyOrders.filter(o => ['placed', 'accepted', 'preparing', 'ready'].includes(o.status)).length}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">Delivered &amp; Billed</span>
                  <strong className="sub-metric-value">{facultyOrders.filter(o => o.status === 'collected').length}</strong>
                </div>
                <div className="sub-metric">
                  <span className="sub-metric-label">Share of Total Orders</span>
                  <strong className="sub-metric-value">{facultyPercentage}%</strong>
                </div>
              </div>

              <div className="stat-footer-bar">
                <span className="stat-footer-note">
                  <TrendingUp size={13} /> Faculty priority quick break service
                </span>
              </div>
            </article>
          </div>

          {/* Visual Ratio Comparison Bar */}
          <div className="staff-ratio-panel">
            <div className="ratio-panel-title">
              <strong>Orders Comparison (Students vs Faculty)</strong>
              <span>
                <strong>{studentCount}</strong> Students ({studentPercentage}%) · <strong>{facultyCount}</strong> Faculty ({facultyPercentage}%)
              </span>
            </div>
            <div className="ratio-bar-track">
              <div
                className="ratio-bar-segment student"
                style={{ width: `${studentPercentage}%` }}
                title={`Students: ${studentCount} orders (${studentPercentage}%)`}
              />
              <div
                className="ratio-bar-segment faculty"
                style={{ width: `${facultyPercentage}%` }}
                title={`Faculty: ${facultyCount} orders (${facultyPercentage}%)`}
              />
            </div>
            <div className="ratio-legend">
              <span className="legend-item student">
                <span className="dot" /> Student Orders: {studentCount}
              </span>
              <span className="legend-item faculty">
                <span className="dot" /> Faculty Orders: {facultyCount}
              </span>
            </div>
          </div>

          {/* Order Lifecycle Pipeline Summary */}
          <div className="staff-pipeline-section">
            <div className="section-sub-title">
              <h3>4-Step Kitchen Pipeline Status</h3>
              <small>Real-time queue across all stages</small>
            </div>
            <div className="pipeline-grid">
              <div className="pipeline-card">
                <span className="pipeline-step-badge">1. Placed</span>
                <strong>{orders.filter(o => o.status === 'placed').length}</strong>
                <small>Waiting acceptance</small>
              </div>
              <div className="pipeline-card">
                <span className="pipeline-step-badge accepted">2. Accepted</span>
                <strong>{orders.filter(o => o.status === 'accepted').length}</strong>
                <small>Queued in kitchen</small>
              </div>
              <div className="pipeline-card">
                <span className="pipeline-step-badge preparing">3. Processing</span>
                <strong>{orders.filter(o => o.status === 'preparing').length}</strong>
                <small>Chefs making order</small>
              </div>
              <div className="pipeline-card highlight">
                <span className="pipeline-step-badge ready">4. Done / Ready</span>
                <strong>{orders.filter(o => o.status === 'ready').length}</strong>
                <small>Ready at counter 🔔</small>
              </div>
              <div className="pipeline-card completed">
                <span className="pipeline-step-badge delivered">Delivered</span>
                <strong>{orders.filter(o => o.status === 'collected').length}</strong>
                <small>Billed &amp; collected</small>
              </div>
            </div>
          </div>

          {/* Recent Orders Overview with Role Badge */}
          <div className="staff-recent-activity">
            <div className="activity-header">
              <h3>Recent Incoming Activity</h3>
              <button
                className="text-button"
                onClick={() => {
                  setTab('orders')
                  navigate('/staff/orders')
                }}
              >
                Go to live orders queue <span>→</span>
              </button>
            </div>

            <div className="recent-orders-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Token #</th>
                    <th>Customer Type</th>
                    <th>Customer Name</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 6).map(order => {
                    const isFaculty = (order.customer_role || order.user_role) === 'faculty'
                    return (
                      <tr key={order.id}>
                        <td>
                          <strong className="token-text">#{order.token_number}</strong>
                        </td>
                        <td>
                          <span className={`staff-role-badge ${isFaculty ? 'faculty' : 'student'}`}>
                            {isFaculty ? 'Faculty' : 'Student'}
                          </span>
                        </td>
                        <td>
                          <strong>{order.customer_name || (isFaculty ? 'Faculty Member' : 'Student')}</strong>
                          {order.customer_id && <small className="block-id">{order.customer_id}</small>}
                        </td>
                        <td>
                          <span className="items-summary-text">
                            {order.items.map(i => `${i.quantity}x ${i.item_name}`).join(', ')}
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill status-${order.status}`}>{order.status}</span>
                        </td>
                        <td>
                          <strong>₹{(order.total_paise / 100).toFixed(0)}</strong>
                        </td>
                        <td>
                          <button
                            className="staff-mini-btn"
                            onClick={() => {
                              setTab('orders')
                              navigate('/staff/orders')
                            }}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: MENU (Menu Management: Add, Remove, Sold Out/Availability, Update details) */}
      {tab === 'menu' && (
        <section className="staff-view-container staff-menu-view">
          <div className="staff-section-bar">
            <div>
              <span className="eyebrow" style={{ color: '#ea580c' }}>CANTEEN INVENTORY</span>
              <h2>Menu Items &amp; Availability</h2>
              <p className="section-subtext">
                Manage live dish listings. Toggle availability, edit prices, descriptions, and food images.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setShowAddMenuModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={18} />
              <span>Add New Dish</span>
            </button>
          </div>

          {/* Quick Counter Summary */}
          <div className="menu-summary-cards">
            <div className="menu-stat-tile">
              <span>Total Dishes</span>
              <strong>{menu.length}</strong>
            </div>
            <div className="menu-stat-tile available">
              <span>Available for Order</span>
              <strong>{availableCount}</strong>
            </div>
            <div className="menu-stat-tile sold">
              <span>Marked Sold Out</span>
              <strong>{soldOutCount}</strong>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="staff-menu-toolbar">
            <div className="staff-search-box">
              <Search size={16} />
              <input
                value={menuQuery}
                onChange={e => setMenuQuery(e.target.value)}
                placeholder="Search dish by name or ingredients…"
              />
              {menuQuery && (
                <button className="clear-search" onClick={() => setMenuQuery('')}>×</button>
              )}
            </div>

            <div className="staff-filter-chips">
              {menuCategories.map(c => (
                <button
                  key={c}
                  className={menuCategory === c ? 'filter-chip active' : 'filter-chip'}
                  onClick={() => setMenuCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="availability-filter-select">
              <select
                value={menuAvailabilityFilter}
                onChange={e => setMenuAvailabilityFilter(e.target.value as any)}
              >
                <option value="all">All Availability</option>
                <option value="available">Available Only</option>
                <option value="sold">Sold Out Only</option>
              </select>
            </div>
          </div>

          {/* Menu Items Grid */}
          <div className="staff-menu-grid">
            {filteredMenuItems.map(item => (
              <article
                key={item.id}
                className={`staff-dish-card ${!item.is_available ? 'is-sold-out' : ''}`}
              >
                <div className="dish-card-media">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="dish-photo" />
                  ) : (
                    <div className="dish-emoji-placeholder">{item.tag || '🌱'}</div>
                  )}
                  <span className="dish-veg-badge">
                    <FssaiVegSymbol />
                  </span>
                  <span className="dish-category-tag">
                    {item.categories?.name || 'Snacks'}
                  </span>
                </div>

                <div className="dish-card-content">
                  <div className="dish-title-row">
                    <h3>{item.name}</h3>
                    <strong className="dish-price">₹{(item.price_paise / 100).toFixed(0)}</strong>
                  </div>
                  <p className="dish-description">{item.description || 'Prepared fresh in campus canteen.'}</p>

                  <div className="dish-status-indicator">
                    {item.is_available ? (
                      <span className="status-pill-small status-available">● Available</span>
                    ) : (
                      <span className="status-pill-small status-sold">○ Sold Out</span>
                    )}
                    {item.ingredients_verified && (
                      <span className="pure-veg-verified-tag">✓ 100% Veg</span>
                    )}
                  </div>
                </div>

                <div className="dish-card-footer">
                  {/* Availability Toggle */}
                  <button
                    className={`toggle-avail-btn ${item.is_available ? 'active-avail' : 'sold-avail'}`}
                    onClick={() => void toggleAvailability(item)}
                    disabled={busy === item.id}
                    title={item.is_available ? 'Click to mark as Sold Out' : 'Click to mark as Available'}
                  >
                    {item.is_available ? (
                      <>
                        <Check size={14} /> Available
                      </>
                    ) : (
                      <>
                        <X size={14} /> Sold Out
                      </>
                    )}
                  </button>

                  {/* Edit Item Details */}
                  <button
                    className="edit-dish-btn"
                    onClick={() => setEditingItem(item)}
                    title="Update name, price, description or image"
                  >
                    <Edit3 size={14} /> Edit
                  </button>

                  {/* Remove Item */}
                  <button
                    className="delete-dish-btn"
                    onClick={() => setItemToDelete(item)}
                    title="Remove item from menu"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>

          {filteredMenuItems.length === 0 && (
            <div className="staff-empty">
              <span>🍽️</span>
              <h3>No dishes match your filter</h3>
              <p>Try clearing your search or add a new menu item.</p>
            </div>
          )}

          {/* Modal: Add Menu Item */}
          {showAddMenuModal && (
            <div className="modal-backdrop" onClick={() => setShowAddMenuModal(false)}>
              <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>
                    <Plus size={18} /> Add New Menu Dish
                  </h3>
                  <button className="modal-close" onClick={() => setShowAddMenuModal(false)}>×</button>
                </div>

                <form onSubmit={handleAddMenuSubmit} className="modal-form">
                  <div className="form-field-grid">
                    <label>
                      Dish Name *
                      <input name="name" required maxLength={120} placeholder="e.g. Masala Dosa, Veg Momos" />
                    </label>

                    <label>
                      Price (₹) *
                      <input name="price" type="number" min="0" step="1" required placeholder="60" />
                    </label>

                    <label>
                      Category
                      <select name="category_id" defaultValue="">
                        <option value="">Select category</option>
                        {categories.filter(c => c.is_active).map(c => (
                          <option value={c.id} key={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Food Emoji Tag
                      <input name="tag" defaultValue="🍛" maxLength={5} placeholder="e.g. 🍛, 🥞, 🥪" />
                    </label>
                  </div>

                  <label>
                    Description / Ingredients
                    <textarea name="description" rows={2} maxLength={500} placeholder="Crispy golden crepe with potato masala & chutneys..." />
                  </label>

                  <label>
                    Food Image URL (Unsplash or Web URL)
                    <input name="image_url" placeholder="https://images.unsplash.com/..." />
                  </label>

                  <div className="preset-images-picker">
                    <small>Or choose from quick food photo presets:</small>
                    <div className="preset-chips-row">
                      {PRESET_FOOD_IMAGES.map(p => (
                        <button
                          key={p.name}
                          type="button"
                          className="preset-chip"
                          onClick={e => {
                            const formEl = (e.currentTarget as HTMLElement).closest('form')
                            if (formEl) {
                              const inputImg = formEl.querySelector('input[name="image_url"]') as HTMLInputElement
                              const inputTag = formEl.querySelector('input[name="tag"]') as HTMLInputElement
                              if (inputImg) inputImg.value = p.url
                              if (inputTag) inputTag.value = p.tag
                            }
                          }}
                        >
                          <span>{p.tag}</span> {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="veg-compliance-box">
                    <label className="checkbox-label">
                      <input type="checkbox" name="ingredients_verified" defaultChecked />
                      <span>
                        <strong>✓ 100% Vegetarian &amp; Egg-Free policy verified</strong>
                        <small>Strict CampusBite policy compliance</small>
                      </span>
                    </label>
                  </div>

                  <div className="modal-actions">
                    <button type="button" className="staff-btn-ghost" onClick={() => setShowAddMenuModal(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="primary-button" disabled={busy === 'new-menu'}>
                      {busy === 'new-menu' ? 'Adding Dish…' : 'Add to Menu'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal: Edit Menu Item */}
          {editingItem && (
            <EditDishModal
              item={editingItem}
              categories={categories}
              busy={busy === editingItem.id}
              onClose={() => setEditingItem(null)}
              onSave={saveMenuItemDetails}
            />
          )}

          {/* Modal: Confirm Delete Menu Item */}
          {itemToDelete && (
            <div className="modal-backdrop" onClick={() => setItemToDelete(null)}>
              <div className="modal-dialog modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header danger">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={20} color="#dc2626" />
                    <h3 style={{ margin: 0, color: '#dc2626' }}>Remove Dish?</h3>
                  </div>
                  <button className="modal-close" onClick={() => setItemToDelete(null)}>×</button>
                </div>
                <div style={{ padding: '16px 0' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '14px', color: '#334155' }}>
                    Are you sure you want to remove <strong>"{itemToDelete.name}"</strong> from the canteen menu?
                  </p>
                  <small style={{ color: '#64748b' }}>Students and faculty will no longer see or be able to order this item.</small>
                </div>
                <div className="modal-actions">
                  <button type="button" className="staff-btn-ghost" onClick={() => setItemToDelete(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button danger"
                    onClick={confirmDeleteMenuItem}
                    disabled={busy === itemToDelete.id}
                  >
                    {busy === itemToDelete.id ? 'Removing…' : 'Yes, Remove Dish'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: ORDERS (Upcoming Orders Management with 4-step workflow + Notification button on ready items) */}
      {tab === 'orders' && (
        <section className="staff-view-container staff-orders-view">
          <div className="staff-section-bar">
            <div>
              <span className="eyebrow" style={{ color: '#ea580c' }}>KITCHEN OPERATIONS</span>
              <h2>Upcoming &amp; Live Orders Queue</h2>
              <p className="section-subtext">
                Accept incoming orders, update kitchen preparation stages, mark ready (done), and notify customers.
              </p>
            </div>
            <div className="orders-header-badge">
              <strong>{activeOrders.length}</strong> active orders in kitchen
            </div>
          </div>

          {/* Order Stage Filter Tabs */}
          <div className="staff-order-stage-tabs">
            <button
              className={ordersFilter === 'all' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('all')}
            >
              All Active Queue <b>{activeOrders.length}</b>
            </button>
            <button
              className={ordersFilter === 'placed' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('placed')}
            >
              1. Placed (New) <b>{orders.filter(o => o.status === 'placed').length}</b>
            </button>
            <button
              className={ordersFilter === 'accepted' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('accepted')}
            >
              2. Accepted <b>{orders.filter(o => o.status === 'accepted').length}</b>
            </button>
            <button
              className={ordersFilter === 'preparing' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('preparing')}
            >
              3. Processing <b>{orders.filter(o => o.status === 'preparing').length}</b>
            </button>
            <button
              className={ordersFilter === 'ready' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('ready')}
            >
              4. Done / Ready 🔔 <b>{orders.filter(o => o.status === 'ready').length}</b>
            </button>
            <button
              className={ordersFilter === 'collected' ? 'stage-tab active' : 'stage-tab'}
              onClick={() => setOrdersFilter('collected')}
            >
              Delivered / Past <b>{deliveredOrders.length}</b>
            </button>
          </div>

          {/* Orders Cards Grid */}
          <div className="staff-order-cards-grid">
            {filteredOrders.map(order => {
              const isFaculty = (order.customer_role || order.user_role) === 'faculty'
              return (
                <article
                  key={order.id}
                  className={`staff-order-card order-status-${order.status} ${order.status === 'ready' ? 'order-ready-highlight' : ''}`}
                >
                  {/* Order Card Header */}
                  <header className="staff-order-card-header">
                    <div className="token-time-wrap">
                      <span className="staff-token-badge">TOKEN #{order.token_number}</span>
                      <small className="order-time-text">{new Date(order.created_at).toLocaleTimeString()}</small>
                    </div>

                    <div className="status-and-role-badges">
                      <span className={`customer-role-pill ${isFaculty ? 'faculty' : 'student'}`}>
                        {isFaculty ? (
                          <>
                            <Briefcase size={12} /> Faculty
                          </>
                        ) : (
                          <>
                            <GraduationCap size={12} /> Student
                          </>
                        )}
                      </span>
                      <span className={`status-pill status-${order.status}`}>{order.status}</span>
                    </div>
                  </header>

                  {/* Customer Info */}
                  <div className="staff-order-customer-row">
                    <strong>{order.customer_name || (isFaculty ? 'Faculty Member' : 'Student')}</strong>
                    {order.customer_id && <span className="customer-id-tag">{order.customer_id}</span>}
                  </div>

                  {/* Items List */}
                  <div className="staff-order-items-list">
                    {order.items.map(line => (
                      <div key={line.id} className="order-item-row">
                        <span className="item-name-qty">
                          <FssaiVegSymbol /> {line.quantity} × {line.item_name}
                        </span>
                        <strong className="item-price">₹{(line.line_total_paise / 100).toFixed(0)}</strong>
                      </div>
                    ))}
                  </div>

                  {/* Payment & Total */}
                  <div className="staff-order-billing-row">
                    <span className="payment-pill">
                      {order.payment_method === 'pay_at_pickup'
                        ? 'Pay at Pickup'
                        : `Online · ${order.payment_status.toUpperCase()}`}
                    </span>
                    <strong className="order-total-price">₹{(order.total_paise / 100).toFixed(0)}</strong>
                  </div>

                  {/* Notification Status Alert for Ready Items */}
                  {order.status === 'ready' && (
                    <div className="ready-notification-alert-box">
                      <div className="ready-alert-text">
                        <BellRing size={16} className="bounce-icon" />
                        <div>
                          <strong>Food Ready for Pickup!</strong>
                          <small>
                            {(order.notifications_sent ?? 0) > 0
                              ? `Notified ${order.notifications_sent} time${order.notifications_sent! > 1 ? 's' : ''}`
                              : 'Waiting for customer pickup'}
                          </small>
                        </div>
                      </div>

                      {/* Re-Notification Button on Ready Items */}
                      <button
                        type="button"
                        className="notify-customer-again-btn"
                        onClick={() => void sendReadyNotification(order)}
                        disabled={notifyingOrderId === order.id}
                        title="Send ready notification to customer"
                      >
                        <Bell size={14} />
                        <span>
                          {notifyingOrderId === order.id ? 'Sending…' : 'Send Notification Again'}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* 4-Step Action Workflow Buttons */}
                  <div className="staff-card-actions">
                    {/* STEP 1: Placed -> Accept Order */}
                    {order.status === 'placed' && (
                      <div className="placed-actions-row">
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
                              placeholder="Reason for declining"
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
                              Back
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              className="step-btn accept-btn"
                              disabled={busy === order.id}
                              onClick={() => void updateOrder(order, 'accepted')}
                            >
                              <span>1. Accept Order</span>
                              <ChevronRight size={16} />
                            </button>
                            <button
                              className="decline-btn"
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

                    {/* STEP 2: Accepted -> Start Processing / Preparing */}
                    {order.status === 'accepted' && (
                      <button
                        className="step-btn processing-btn full-width"
                        disabled={busy === order.id}
                        onClick={() => void updateOrder(order, 'preparing')}
                      >
                        <span>2. Start Processing (Kitchen Making)</span>
                        <ChevronRight size={16} />
                      </button>
                    )}

                    {/* STEP 3: Preparing -> Mark Done (Ready) - Automatically gives notification */}
                    {order.status === 'preparing' && (
                      <button
                        className="step-btn done-ready-btn full-width"
                        disabled={busy === order.id}
                        onClick={() => void updateOrder(order, 'ready')}
                      >
                        <Bell size={16} />
                        <span>3. Mark Done (Food Ready)</span>
                        <Check size={16} />
                      </button>
                    )}

                    {/* STEP 4: Ready -> Mark Delivered / Billing Completed */}
                    {order.status === 'ready' && (
                      <button
                        className="step-btn delivered-btn full-width"
                        disabled={busy === order.id}
                        onClick={() => void updateOrder(order, 'collected')}
                      >
                        <CheckCircle2 size={16} />
                        <span>4. Mark Delivered &amp; Completed Billing</span>
                      </button>
                    )}

                    {/* Completed Order */}
                    {order.status === 'collected' && (
                      <div className="collected-check-text">
                        <CheckCircle2 size={15} color="#16a34a" />
                        <span>Delivered &amp; Handed Over</span>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {filteredOrders.length === 0 && (
            <div className="staff-empty">
              <span>☕</span>
              <h3>No orders in this stage</h3>
              <p>When students or faculty members place orders, they will appear here live.</p>
            </div>
          )}
        </section>
      )}

      {/* TAB 4: PROFILE (Profile of Staff) */}
      {tab === 'profile' && (
        <section className="staff-view-container staff-profile-view">
          <div className="staff-section-bar">
            <div>
              <span className="eyebrow" style={{ color: '#ea580c' }}>OPERATOR ACCOUNT</span>
              <h2>Canteen Staff Profile</h2>
              <p className="section-subtext">
                Your staff credentials, shift information, operator preferences, and account controls.
              </p>
            </div>
          </div>

          <div className="staff-profile-card">
            <div className="staff-profile-header">
              <div className="staff-profile-avatar">
                {auth.profile?.full_name
                  ? auth.profile.full_name
                      .split(' ')
                      .map(n => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()
                  : 'ST'}
              </div>
              <div className="staff-profile-info">
                <h2>{auth.profile?.full_name || 'Canteen Staff Operator'}</h2>
                <p>{auth.user?.email || 'staff@campusbite.local'}</p>
                <div className="staff-role-chips">
                  <span className="profile-role-pill staff-badge">Canteen Staff</span>
                  <span className="staff-status-active">● Active Operator</span>
                </div>
              </div>
            </div>

            <div className="staff-details-grid">
              <div className="staff-detail-item">
                <span className="detail-label">Staff / Employee ID</span>
                <strong className="detail-value">{auth.profile?.student_id || 'STF-CANTEEN-01'}</strong>
              </div>
              <div className="staff-detail-item">
                <span className="detail-label">Canteen Department</span>
                <strong className="detail-value">Campus Main Canteen &amp; Counter 1</strong>
              </div>
              <div className="staff-detail-item">
                <span className="detail-label">Operating Shift</span>
                <strong className="detail-value">Breakfast &amp; Lunch Hours (08:00 - 18:00)</strong>
              </div>
              <div className="staff-detail-item">
                <span className="detail-label">Orders Handled</span>
                <strong className="detail-value">{totalOrdersCount} Total ({studentCount} Students · {facultyCount} Faculty)</strong>
              </div>
            </div>

            {/* Quick Staff Controls */}
            <div className="staff-profile-actions-row">
              <button
                className="staff-btn-outline"
                onClick={async () => {
                  await auth.setRole('student')
                  navigate('/menu')
                }}
                title="Switch view to test student experience"
              >
                Switch to Student View
              </button>
              <button
                className="primary-button"
                onClick={() => void auth.signOut()}
              >
                Sign Out of Canteen
              </button>
            </div>
          </div>

          {/* Danger Zone: Delete Canteen Staff Profile */}
          <div className="staff-danger-zone">
            <div>
              <span className="eyebrow" style={{ color: '#b91c1c' }}>DANGER ZONE</span>
              <h3>Delete Canteen Staff Profile</h3>
              <p>Permanently remove your canteen staff profile and credentials.</p>
            </div>
            <button
              className="primary-button danger"
              onClick={() => setShowDeleteStaffModal(true)}
            >
              <Trash2 size={16} /> Delete Staff Profile
            </button>
          </div>

          {/* Delete Staff Modal */}
          {showDeleteStaffModal && (
            <div className="modal-backdrop" onClick={() => setShowDeleteStaffModal(false)}>
              <div className="modal-dialog modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header danger">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={20} color="#dc2626" />
                    <h3 style={{ margin: 0, color: '#dc2626' }}>Delete Staff Account?</h3>
                  </div>
                  <button className="modal-close" onClick={() => setShowDeleteStaffModal(false)}>×</button>
                </div>
                <div style={{ padding: '16px 0' }}>
                  {deleteStaffError && <p className="inline-alert">{deleteStaffError}</p>}
                  <p style={{ margin: '0 0 10px', fontSize: '14px', color: '#334155' }}>
                    Are you sure you want to delete the staff profile for <strong>{auth.profile?.full_name || auth.user?.email}</strong>?
                  </p>
                  <small style={{ color: '#64748b' }}>Your canteen access will be permanently revoked immediately.</small>
                </div>
                <div className="modal-actions">
                  <button type="button" className="staff-btn-ghost" onClick={() => setShowDeleteStaffModal(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button danger"
                    onClick={confirmDeleteStaff}
                    disabled={deletingStaff}
                  >
                    {deletingStaff ? 'Deleting…' : 'Yes, Delete Profile'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function EditDishModal({
  item,
  categories,
  busy,
  onClose,
  onSave,
}: {
  item: MenuItem
  categories: Category[]
  busy: boolean
  onClose: () => void
  onSave: (item: MenuItem, payload: Partial<MenuItem>) => void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description || '')
  const [price, setPrice] = useState((item.price_paise / 100).toFixed(0))
  const [categoryId, setCategoryId] = useState(item.category_id ?? '')
  const [imageUrl, setImageUrl] = useState(item.image_url || '')
  const [tag, setTag] = useState(item.tag || '🍛')
  const [verified, setVerified] = useState(Boolean(item.ingredients_verified))

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    onSave(item, {
      name: name.trim(),
      description: description.trim(),
      price_paise: Math.round(Number(price) * 100),
      category_id: categoryId || null,
      image_url: imageUrl.trim() || null,
      tag: tag.trim() || '🍛',
      ingredients_verified: verified,
      is_vegetarian: true,
      contains_egg: false,
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Edit3 size={18} /> Edit Dish: {item.name}
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSave} className="modal-form">
          <div className="form-field-grid">
            <label>
              Dish Name *
              <input value={name} onChange={e => setName(e.target.value)} required maxLength={120} />
            </label>

            <label>
              Price (₹) *
              <input
                type="number"
                min="0"
                step="1"
                value={price}
                onChange={e => setPrice(e.target.value)}
                required
              />
            </label>

            <label>
              Category
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categories.filter(c => c.is_active).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label>
              Food Emoji
              <input value={tag} onChange={e => setTag(e.target.value)} maxLength={5} />
            </label>
          </div>

          <label>
            Description / Ingredients
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </label>

          <label>
            Food Image URL
            <input
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
            />
          </label>

          {/* Preset image quick pick */}
          <div className="preset-images-picker">
            <small>Or choose preset food photo:</small>
            <div className="preset-chips-row">
              {PRESET_FOOD_IMAGES.map(p => (
                <button
                  key={p.name}
                  type="button"
                  className="preset-chip"
                  onClick={() => {
                    setImageUrl(p.url)
                    setTag(p.tag)
                  }}
                >
                  <span>{p.tag}</span> {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="veg-compliance-box">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={verified}
                onChange={e => setVerified(e.target.checked)}
              />
              <span>
                <strong>✓ 100% Vegetarian &amp; Egg-Free policy verified</strong>
              </span>
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="staff-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
