import { useEffect, useMemo, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  ArrowRight,
  ClipboardList,
  Clock3,
  Coffee,
  Heart,
  Home,
  Menu as MenuIcon,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  User,
  Utensils,
  X,
} from 'lucide-react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'
import { AuthPage, CartPage, CheckoutPage, OrdersPage, ProfilePage, TrackingPage } from './StudentPages'
import StaffDashboard from './StaffDashboard'
import AdminDashboard from './AdminDashboard'

export type MenuItem = {
  id: string | number
  name: string
  description: string
  category: string
  price_paise: number
  is_available: boolean
  is_vegetarian?: boolean
  contains_egg?: boolean
  ingredients_verified?: boolean
  tag: string
  color: string
}

type Cart = Record<string, number>
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function FssaiVegSymbol() {
  return (
    <span
      className="fssai-veg-symbol"
      title="Vegetarian"
      aria-label="Vegetarian"
    >
      <span className="fssai-dot" />
    </span>
  )
}

function App() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let remove: (() => void) | undefined
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) navigate(-1)
      else void CapacitorApp.exitApp()
    }).then(handle => {
      remove = () => void handle.remove()
    })
    return () => remove?.()
  }, [navigate])

  const [items, setItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<Cart>(() => {
    try {
      return JSON.parse(localStorage.getItem('campusbite-cart') ?? '{}') as Cart
    } catch {
      return {}
    }
  })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    fetch(`${apiUrl}/api/menu`)
      .then(async r => {
        if (!r.ok) throw new Error()
        return r.json() as Promise<MenuItem[]>
      })
      .then(data => {
        // Enforce vegetarian items only (non-veg is prohibited)
        const vegOnly = data.filter(i => (i.is_vegetarian ?? true) && !(i.contains_egg ?? false))
        setItems(vegOnly)
      })
      .catch(() =>
        setError('Could not load the menu. Check that the API is running at http://localhost:8000, then refresh.')
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    localStorage.setItem('campusbite-cart', JSON.stringify(cart))
  }, [cart])

  const categories = ['All', ...Array.from(new Set(items.map(item => item.category)))]
  const shown = useMemo(
    () =>
      items.filter(
        i =>
          i.is_available &&
          (category === 'All' || i.category === category) &&
          `${i.name} ${i.description}`.toLowerCase().includes(query.toLowerCase())
      ),
    [items, category, query]
  )

  const count = Object.values(cart).reduce((a, b) => a + b, 0)
  const total = items.reduce((s, i) => s + i.price_paise * (cart[i.id] ?? 0), 0)
  const sampleMenu = items.some(i => typeof i.id === 'number')

  const update = (id: string | number, d: number) =>
    setCart(c => ({ ...c, [String(id)]: Math.max(0, (c[String(id)] ?? 0) + d) }))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={22} /> : <MenuIcon size={22} />}
          </button>
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Coffee size={18} />
            </span>
            <span>
              campus<span className="brand-accent">bite</span>
            </span>
          </Link>
        </div>
        <nav className="desktop-nav">
          <Link className={location.pathname === '/' ? 'nav-active' : ''} to="/">
            Home
          </Link>
          <Link className={location.pathname === '/menu' ? 'nav-active' : ''} to="/menu">
            Menu
          </Link>
          <Link className={location.pathname === '/orders' ? 'nav-active' : ''} to="/orders">
            My Orders
          </Link>
          <Link className={location.pathname === '/profile' ? 'nav-active' : ''} to="/profile">
            Profile
          </Link>
          {auth.profile &&
            (auth.profile.role === 'canteen_staff' || auth.profile.role === 'admin') && (
              <Link className={location.pathname === '/staff' ? 'nav-active' : ''} to="/staff">
                Canteen
              </Link>
            )}
          {auth.profile?.role === 'admin' && (
            <Link className={location.pathname === '/admin' ? 'nav-active' : ''} to="/admin">
              Admin
            </Link>
          )}
          <a href="/#about">About</a>
        </nav>
        <div className="top-actions">
          {auth.user ? (
            <>
              <Link className="signin desktop-only" to="/profile">
                {auth.profile?.full_name?.split(' ')[0] ?? 'Profile'}
              </Link>
              <button className="signin desktop-only" onClick={() => void auth.signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <Link className="signin desktop-only" to="/login">
              Sign in
            </Link>
          )}
          <button
            className="cart-button"
            onClick={() => navigate('/cart')}
            aria-label={`Open cart, ${count} items`}
          >
            <ShoppingBag size={17} />
            <span className="cart-label">Cart</span>
            {count > 0 && <b>{count}</b>}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setMobileMenuOpen(false)}>
          <aside className="mobile-drawer" onClick={e => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <Link to="/" className="brand" onClick={() => setMobileMenuOpen(false)}>
                <span className="brand-mark">
                  <Coffee size={18} />
                </span>
                <span>
                  campus<span className="brand-accent">bite</span>
                </span>
              </Link>
              <button
                className="close-button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            {auth.user && auth.profile && (
              <div className="mobile-user-card">
                <div className="profile-avatar">
                  {auth.profile.full_name
                    ? auth.profile.full_name
                        .split(' ')
                        .map(n => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                    : 'CB'}
                </div>
                <div className="mobile-user-info">
                  <strong>{auth.profile.full_name || 'Student'}</strong>
                  <small>{auth.user.email}</small>
                  {auth.profile.student_id && (
                    <span className="profile-student-id">Roll: {auth.profile.student_id}</span>
                  )}
                </div>
              </div>
            )}

            <nav className="mobile-nav-links">
              <Link
                className={location.pathname === '/' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                to="/"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Home size={18} />
                <span>Home</span>
              </Link>
              <Link
                className={location.pathname === '/menu' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                to="/menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Utensils size={18} />
                <span>Menu</span>
              </Link>
              <Link
                className={location.pathname === '/orders' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                to="/orders"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Clock3 size={18} />
                <span>My Orders</span>
              </Link>
              <Link
                className={location.pathname === '/profile' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                to="/profile"
                onClick={() => setMobileMenuOpen(false)}
              >
                <User size={18} />
                <span>Profile</span>
              </Link>
              {auth.profile &&
                (auth.profile.role === 'canteen_staff' || auth.profile.role === 'admin') && (
                  <Link
                    className={location.pathname === '/staff' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                    to="/staff"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Coffee size={18} />
                    <span>Canteen Kitchen</span>
                  </Link>
                )}
              {auth.profile?.role === 'admin' && (
                <Link
                  className={location.pathname === '/admin' ? 'mobile-nav-link active' : 'mobile-nav-link'}
                  to="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <ClipboardList size={18} />
                  <span>Admin Dashboard</span>
                </Link>
              )}
            </nav>

            <div className="mobile-drawer-footer">
              {auth.user ? (
                <button
                  className="primary-button full-width"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    void auth.signOut()
                  }}
                >
                  Sign out
                </button>
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  <Link
                    className="primary-button full-width"
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign in
                  </Link>
                  <Link
                    className="text-button"
                    style={{ textAlign: 'center', padding: '6px' }}
                    to="/register"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Create student account <span>→</span>
                  </Link>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      <Routes>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route
          path="/"
          element={
            <main>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="live-dot" /> YOUR CAMPUS CANTEEN, REIMAGINED
                  </div>
                  <h1>
                    Good food.<br />
                    <em>Zero queue.</em>
                  </h1>
                  <p className="hero-description">
                    Your next campus break is just a few taps away. Order your favourites ahead, skip the line, and get back to what matters.
                  </p>
                  <div className="hero-buttons">
                    <a className="primary-button" href="#menu">
                      Explore the menu <ArrowRight size={17} />
                    </a>
                    <Link className="text-button" to="/profile">
                      {auth.user ? 'My Profile' : 'Student Profile'} <span>↗</span>
                    </Link>
                  </div>
                  <div className="social-proof">
                    <p>
                      <strong>Made for campus breaks</strong>
                      <br />
                      <span>Fresh, quick and ready when you arrive.</span>
                    </p>
                  </div>
                </div>
                <div className="hero-visual">
                  <div className="hero-orbit orbit-one" />
                  <div className="hero-orbit orbit-two" />
                  <div className="hero-plate">
                    <img
                      src="https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=1000&q=85"
                      alt="Freshly prepared delicious meal"
                    />
                    <span className="plate-leaf">✳</span>
                  </div>
                  <div className="float-card pickup-card">
                    <span className="float-icon blue">
                      <Clock3 size={16} />
                    </span>
                    <span>
                      <strong>Order ahead</strong>
                      <small>Pick up hot &amp; fresh</small>
                    </span>
                  </div>
                  <div className="float-card fresh-card">
                    <span className="float-icon yellow">
                      <Sparkles size={16} />
                    </span>
                    <span>
                      <strong>Made to order</strong>
                      <small>Freshly prepared for you</small>
                    </span>
                  </div>
                  <span className="sparkle sparkle-a">✳</span>
                  <span className="sparkle sparkle-b">✦</span>
                </div>
                <div className="hero-note">
                  <span>01</span> GOOD FOOD, BETTER DAYS
                </div>
              </section>

              <section className="benefits">
                <div>
                  <span className="benefit-icon">
                    <Sparkles size={17} />
                  </span>
                  <span>
                    <strong>Made Fresh</strong>
                    <small>Prepared fresh every order</small>
                  </span>
                </div>
                <div>
                  <span className="benefit-icon">
                    <Clock3 size={17} />
                  </span>
                  <span>
                    <strong>Skip the Queue</strong>
                    <small>Order ahead, easy counter pickup</small>
                  </span>
                </div>
                <div>
                  <span className="benefit-icon">
                    <Coffee size={17} />
                  </span>
                  <span>
                    <strong>Campus Prices</strong>
                    <small>Great taste, student-friendly rates</small>
                  </span>
                </div>
                <div className="canteen-status">
                  <span className="live-dot" />
                  <span>
                    <strong>Campus Canteen</strong>
                    <small>Online &amp; Pay-at-pickup ready</small>
                  </span>
                  <ArrowRight size={16} />
                </div>
              </section>

              <section className="menu-section" id="menu">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">THE GOOD STUFF</div>
                    <h2>
                      Today’s favourites<span>.</span>
                    </h2>
                  </div>
                  <Link to="/menu" className="view-all">
                    View all items <ArrowRight size={16} />
                  </Link>
                </div>
                <div className="menu-toolbar">
                  <div className="category-list">
                    {categories.map(c => (
                      <button
                        key={c}
                        onClick={() => setCategory(c)}
                        className={category === c ? 'category-chip selected' : 'category-chip'}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Find something delicious…"
                      aria-label="Search menu"
                    />
                  </label>
                </div>

                {loading ? (
                  <div className="menu-grid">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(x => (
                      <div key={x} className="skeleton-card" />
                    ))}
                  </div>
                ) : error ? (
                  <div className="empty-state">{error}</div>
                ) : shown.length ? (
                  <div className="menu-grid">
                    {shown.map(i => (
                      <article className="food-card" key={i.id}>
                        <div className={`food-art ${i.color}`}>
                          <div className="food-emoji">{i.tag}</div>
                          <span className="food-tag">{i.category}</span>
                          <span className="veg-badge-corner">
                            <FssaiVegSymbol />
                          </span>
                          <button
                            className={cart[i.id] ? 'add-food added' : 'add-food'}
                            aria-label={`Add ${i.name}`}
                            onClick={() => update(i.id, 1)}
                          >
                            {cart[i.id] ? (
                              <>
                                {cart[i.id]} <Plus size={14} />
                              </>
                            ) : (
                              <Plus size={17} />
                            )}
                          </button>
                        </div>
                        <div className="food-info">
                          <div>
                            <div className="food-title-row">
                              <FssaiVegSymbol />
                              <h3>{i.name}</h3>
                            </div>
                            <p>{i.description}</p>
                          </div>
                          <strong className="price">₹{(i.price_paise / 100).toFixed(0)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    Nothing matches that search. Try another item or category.
                  </div>
                )}
                <div className="sample-note">
                  {sampleMenu
                    ? 'Sample menu for development · Live menu is updated from canteen inventory'
                    : 'Menu prices and availability are verified upon ordering'}
                </div>
              </section>

              <footer id="about">
                <Link to="/" className="brand">
                  <span className="brand-mark">
                    <Coffee size={16} />
                  </span>
                  <span>
                    campus<span className="brand-accent">bite</span>
                  </span>
                </Link>
                <span>Good food. Good breaks. Good campus.</span>
                <span>
                  Made for campus life <Heart size={12} className="heart" />
                </span>
              </footer>
            </main>
          }
        />
        <Route
          path="/menu"
          element={
            <main className="menu-route">
              <section className="menu-section">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">ALL ITEMS</div>
                    <h2>
                      Today’s Menu<span>.</span>
                    </h2>
                  </div>
                </div>
                <div className="menu-toolbar">
                  <div className="category-list">
                    {categories.map(c => (
                      <button
                        key={c}
                        onClick={() => setCategory(c)}
                        className={category === c ? 'category-chip selected' : 'category-chip'}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Find something delicious…"
                      aria-label="Search menu"
                    />
                  </label>
                </div>
                {loading ? (
                  <div className="empty-state">Loading menu…</div>
                ) : error ? (
                  <div className="empty-state">{error}</div>
                ) : shown.length ? (
                  <div className="menu-grid">
                    {shown.map(i => (
                      <article className="food-card" key={i.id}>
                        <div className={`food-art ${i.color}`}>
                          <div className="food-emoji">{i.tag}</div>
                          <span className="food-tag">{i.category}</span>
                          <span className="veg-badge-corner">
                            <FssaiVegSymbol />
                          </span>
                          <button
                            className={cart[i.id] ? 'add-food added' : 'add-food'}
                            aria-label={`Add ${i.name}`}
                            onClick={() => update(i.id, 1)}
                          >
                            {cart[i.id] ? (
                              <>
                                {cart[i.id]} <Plus size={14} />
                              </>
                            ) : (
                              <Plus size={17} />
                            )}
                          </button>
                        </div>
                        <div className="food-info">
                          <div>
                            <div className="food-title-row">
                              <FssaiVegSymbol />
                              <h3>{i.name}</h3>
                            </div>
                            <p>{i.description}</p>
                          </div>
                          <strong className="price">₹{(i.price_paise / 100).toFixed(0)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nothing matches that search.</div>
                )}
                <div className="sample-note">
                  {sampleMenu
                    ? 'Sample menu for development · Live menu updates from canteen database'
                    : 'Menu prices and availability are checked again when you order'}
                </div>
              </section>
            </main>
          }
        />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage register />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/cart" element={<CartPage items={items} cart={cart} update={update} />} />
        <Route
          path="/checkout"
          element={
            <CheckoutPage items={items} cart={cart} clearCart={() => setCart({})} />
          }
        />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/staff" element={<StaffDashboard />} />
        <Route path="/orders/:orderId" element={<TrackingPage />} />
        <Route
          path="*"
          element={
            <main className="student-page">
              <section className="student-card">
                <h1>Page not found</h1>
                <Link to="/">Return home</Link>
              </section>
            </main>
          }
        />
      </Routes>

      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => setCartOpen(false)}>
          <aside className="cart-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-heading">
              <div>
                <div className="eyebrow">YOUR ORDER</div>
                <h2>
                  Your bag<span>.</span>
                </h2>
              </div>
              <button
                className="close-button"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                <X size={20} />
              </button>
            </div>
            {count === 0 ? (
              <div className="cart-empty">
                <span>🥡</span>
                <h3>Your bag is waiting</h3>
                <p>Add a favourite from the menu and it’ll show up here.</p>
                <button className="primary-button" onClick={() => setCartOpen(false)}>
                  Explore menu <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="cart-lines">
                  {items
                    .filter(i => cart[i.id])
                    .map(i => (
                      <div className="cart-line" key={i.id}>
                        <span className={`cart-thumb ${i.color}`}>{i.tag}</span>
                        <div className="cart-line-copy">
                          <strong>
                            <FssaiVegSymbol /> {i.name}
                          </strong>
                          <small>₹{(i.price_paise / 100).toFixed(0)}</small>
                        </div>
                        <div className="quantity-control">
                          <button
                            onClick={() => update(i.id, -1)}
                            aria-label={`Remove one ${i.name}`}
                          >
                            <Minus size={13} />
                          </button>
                          <span>{cart[i.id]}</span>
                          <button
                            onClick={() => update(i.id, 1)}
                            aria-label={`Add one ${i.name}`}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                <div className="cart-total">
                  <span>Subtotal</span>
                  <strong>₹{(total / 100).toFixed(0)}</strong>
                </div>
                <button
                  className="primary-button checkout-button"
                  onClick={() => {
                    setCartOpen(false)
                    navigate('/checkout')
                  }}
                >
                  Review checkout <ArrowRight size={16} />
                </button>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link
          to="/"
          className={location.pathname === '/' ? 'mobile-tab active' : 'mobile-tab'}
        >
          <Home size={20} />
          <span>Home</span>
        </Link>
        <Link
          to="/menu"
          className={location.pathname === '/menu' ? 'mobile-tab active' : 'mobile-tab'}
        >
          <Utensils size={20} />
          <span>Menu</span>
        </Link>
        <Link
          to="/cart"
          className={location.pathname === '/cart' ? 'mobile-tab active' : 'mobile-tab'}
        >
          <div className="mobile-tab-icon-wrap">
            <ShoppingBag size={20} />
            {count > 0 && <span className="mobile-cart-badge">{count}</span>}
          </div>
          <span>Cart</span>
        </Link>
        <Link
          to="/orders"
          className={location.pathname.startsWith('/orders') ? 'mobile-tab active' : 'mobile-tab'}
        >
          <Clock3 size={20} />
          <span>Orders</span>
        </Link>
        <Link
          to={auth.user ? '/profile' : '/login'}
          className={
            location.pathname === '/profile' || location.pathname === '/login'
              ? 'mobile-tab active'
              : 'mobile-tab'
          }
        >
          <User size={20} />
          <span>{auth.user ? 'Profile' : 'Sign in'}</span>
        </Link>
      </nav>
    </div>
  )
}

export default App
