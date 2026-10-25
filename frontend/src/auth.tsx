import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient, Session, User } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined
export const supabase = url && anonKey ? createClient(url, anonKey) : null
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type Profile = {
  id: string
  full_name: string
  student_id: string | null
  role: 'student' | 'faculty' | 'canteen_staff' | 'admin'
  account_status: 'active' | 'pending' | 'suspended'
  created_at: string
}

type AuthValue = {
  configured: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  profileError: string
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    name: string,
    studentId: string,
    userType?: 'student' | 'faculty' | 'canteen_staff'
  ) => Promise<boolean>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (fullName: string, studentId: string) => Promise<void>
  deleteProfile: () => Promise<{ authDeleted: boolean; authErrorMsg: string }>
  setRole: (role: 'student' | 'faculty' | 'canteen_staff' | 'admin') => Promise<void>
}


const Context = createContext<AuthValue | null>(null)

export function formatNameFromEmail(email?: string | null): string {
  if (!email) return ''
  const local = email.split('@')[0]
  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\d+$/, '').trim()
  if (!cleaned) return email.split('@')[0]
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function isGenericName(name?: string | null): boolean {
  if (!name) return true
  const n = name.trim().toLowerCase()
  return (
    n === 'campus student' ||
    n === 'campus faculty' ||
    n === 'faculty member' ||
    n === 'canteen staff demo' ||
    n === 'unnamed user' ||
    n === 'student'
  )
}

export function resolveDisplayName(
  fullName?: string | null,
  email?: string | null,
  role?: string | null
): string {
  const raw = (fullName ?? '').trim()
  if (raw && !isGenericName(raw)) {
    return raw
  }

  const fromEmail = formatNameFromEmail(email)
  if (fromEmail) {
    return fromEmail
  }

  if (role === 'faculty') return 'Faculty Member'
  if (role === 'canteen_staff') return 'Canteen Staff'
  return 'Student'
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadProfile = async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      setProfileError('')
      return
    }

    if (s.user?.user_metadata?.is_deleted) {
      if (supabase) {
        await supabase.auth.signOut().catch(() => {})
      }
      setProfile(null)
      setSession(null)
      setProfileError('This account has been deleted.')
      return
    }

    const meta = s.user?.user_metadata ?? {}
    const emailName = formatNameFromEmail(s.user?.email)
    const rawMetaName = ((meta.full_name as string) || (meta.name as string) || '').trim()
    const fallbackName = resolveDisplayName(rawMetaName || emailName, s.user?.email, (meta.role as string) || 'student')
    const fallbackStudentId = (meta.student_id as string) || null

    const devRole = localStorage.getItem('campusbite-dev-role') as Profile['role'] | null

    try {
      const r = await fetch(`${apiUrl}/api/me`, {
        headers: { Authorization: `Bearer ${s.access_token}` },
      })
      if (r.status === 401) {
        const errData = await r.json().catch(() => null)
        if (errData?.detail?.includes('deleted')) {
          if (supabase) await supabase.auth.signOut().catch(() => {})
          setProfile(null)
          setSession(null)
          setProfileError('This account has been deleted.')
          return
        }
      }
      if (r.ok) {
        const data = (await r.json()) as Profile
        const resolvedName = resolveDisplayName(
          rawMetaName || (!isGenericName(data.full_name) ? data.full_name : '') || emailName,
          s.user?.email,
          devRole || data.role || 'student'
        )
        setProfile({
          ...data,
          full_name: resolvedName,
          student_id: data.student_id ? data.student_id : fallbackStudentId,
          role: devRole || data.role || 'student',
        })
        setProfileError('')
        return
      }
    } catch {
      // Backend /api/me might be loading or offline
    }

    // Reliable fallback to auth session metadata so student/faculty name and roll no always show
    setProfile({
      id: s.user?.id ?? '',
      full_name: fallbackName,
      student_id: fallbackStudentId,
      role: devRole || (meta.role as Profile['role']) || 'student',
      account_status: 'active',
      created_at: s.user?.created_at || new Date().toISOString(),
    })
    setProfileError('')
  }


  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session)
      if (active) setLoading(false)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      window.setTimeout(() => {
        if (active) void loadProfile(s)
      }, 0)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      configured: !!supabase,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      loading,
      signIn: async (email, password) => {
        if (!supabase) throw new Error('Add Supabase credentials to frontend/.env.local first.')
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
        if (error) throw error
        if (data?.user?.user_metadata?.is_deleted) {
          // Reactivate previously deleted account
          await supabase.auth.updateUser({
            data: { is_deleted: false, deleted_at: null },
          }).catch(() => {})
          if (data.session?.access_token) {
            await fetch(`${apiUrl}/api/me/reactivate`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${data.session.access_token}` },
            }).catch(() => {})
          }
        }
      },
      signUp: async (email, password, name, studentId, userType = 'student') => {
        if (!supabase) throw new Error('Add Supabase credentials to frontend/.env.local first.')
        const role = userType
        const cleanEmail = email.trim().toLowerCase()

        // 1. Attempt initial sign up
        let { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: name,
              student_id: studentId,
              role: role,
              user_type: userType,
              is_deleted: false,
            },
          },
        })

        // If email already exists in auth.users (e.g. from previously deleted profile)
        if (error && error.message.toLowerCase().includes('already registered')) {
          // A. Attempt backend admin cleanup (deletes row from auth.users if service_role_key is configured)
          try {
            const cleanRes = await fetch(`${apiUrl}/api/auth/cleanup-user`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: cleanEmail }),
            })
            const cleanData = await cleanRes.json().catch(() => null)
            if (cleanData?.cleaned) {
              const retry = await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                  data: {
                    full_name: name,
                    student_id: studentId,
                    role: role,
                    user_type: userType,
                    is_deleted: false,
                  },
                },
              })
              if (!retry.error) {
                if (retry.data.session) {
                  setSession(retry.data.session)
                  localStorage.setItem('campusbite-dev-role', role)
                  setProfile({
                    id: retry.data.user?.id ?? '',
                    full_name: name,
                    student_id: studentId,
                    role: role,
                    account_status: 'active',
                    created_at: retry.data.user?.created_at || new Date().toISOString(),
                  })
                }
                return !retry.data.session
              }
            }
          } catch {
            // Backend cleanup not available
          }

          // B. Attempt authentication with the credentials just entered (reclaims previously deleted account)
          try {
            const loginRes = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            })
            if (loginRes.data.session && loginRes.data.user) {
              await supabase.auth.updateUser({
                data: {
                  full_name: name,
                  student_id: studentId,
                  role: role,
                  user_type: userType,
                  is_deleted: false,
                  deleted_at: null,
                },
              })
              if (loginRes.data.session.access_token) {
                await fetch(`${apiUrl}/api/me/reactivate`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${loginRes.data.session.access_token}` },
                }).catch(() => {})
              }
              setSession(loginRes.data.session)
              localStorage.setItem('campusbite-dev-role', role)
              setProfile({
                id: loginRes.data.user.id,
                full_name: name,
                student_id: studentId,
                role: role,
                account_status: 'active',
                created_at: loginRes.data.user.created_at || new Date().toISOString(),
              })
              return false
            }
          } catch {
            // Password did not match existing account
          }
        }

        if (error) throw error
        if (data.session) {
          setSession(data.session)
          localStorage.setItem('campusbite-dev-role', role)
          setProfile({
            id: data.user?.id ?? '',
            full_name: name,
            student_id: studentId,
            role: role,
            account_status: 'active',
            created_at: data.user?.created_at || new Date().toISOString(),
          })
        }
        return !data.session
      },
      signOut: async () => {
        localStorage.removeItem('campusbite-dev-role')
        setSession(null)
        setProfile(null)
        setProfileError('')
        if (supabase) {
          try {
            await supabase.auth.signOut()
          } catch {
            // Ignore offline errors
          }
        }
      },

      refreshProfile: async () => loadProfile(session),
      updateProfile: async (fullName: string, studentId: string) => {
        const cleanName = fullName.trim()
        const cleanRoll = studentId.trim() || null

        // 1. Update Supabase user metadata
        if (supabase) {
          await supabase.auth.updateUser({
            data: { full_name: cleanName, student_id: cleanRoll },
          })
        }

        // 2. Update backend profile if active session token exists
        if (session?.access_token) {
          try {
            await fetch(`${apiUrl}/api/me/profile`, {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ full_name: cleanName, student_id: cleanRoll }),
            })
          } catch {
            // Ignore if backend service role is offline
          }
        }

        // 3. Immediately update in-memory state so the UI reflects instantly
        setProfile(prev =>
          prev
            ? { ...prev, full_name: cleanName, student_id: cleanRoll }
            : {
                id: session?.user?.id ?? '',
                full_name: cleanName,
                student_id: cleanRoll,
                role: 'student',
                account_status: 'active',
                created_at: new Date().toISOString(),
              }
        )
      },
      setRole: async (newRole: 'student' | 'faculty' | 'canteen_staff' | 'admin') => {
        localStorage.setItem('campusbite-dev-role', newRole)
        setProfile(prev => {
          if (prev) {
            return { ...prev, role: newRole }
          }
          const defaultName = resolveDisplayName(null, session?.user?.email, newRole)
          return {
            id: session?.user?.id ?? 'demo-user',
            full_name: defaultName,
            student_id: newRole === 'faculty' ? 'FAC-101' : newRole === 'student' ? '2026CS101' : null,
            role: newRole,
            account_status: 'active',
            created_at: new Date().toISOString(),
          }
        })
        if (session?.access_token) {
          try {
            await fetch(`${apiUrl}/api/me/role`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ role: newRole }),
            })
          } catch {
            // Dev in-memory role is active
          }
        }
      },
      deleteProfile: async () => {
        let authDeleted = false
        let authErrorMsg = ''
        const currentUserId = session?.user?.id

        // 1. Backend deletion: deletes profile, orders, payments, marks user ID deleted in backend
        const token = session?.access_token || 'demo-staff-token'
        if (token) {
          try {
            const res = await fetch(`${apiUrl}/api/me/profile`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            })
            const data = await res.json().catch(() => null)
            if (data?.deleted_from_auth) {
              authDeleted = true
            } else if (data?.auth_warning && !authErrorMsg) {
              authErrorMsg = data.auth_warning
            }
          } catch {
            // Ignore offline backend
          }
        }

        // 2. Supabase deletion / credentials scrambling
        if (supabase) {
          // A. Try calling database RPC function delete_user_self
          try {
            const { error: rpcErr } = await supabase.rpc('delete_user_self')
            if (!rpcErr) {
              authDeleted = true
            } else {
              const { error: rpcErr2 } = await supabase.rpc('delete_user_profile')
              if (!rpcErr2) {
                authDeleted = true
              }
            }
          } catch {
            // RPC not available
          }

          // B. Delete profile row directly if public.profiles exists
          try {
            if (currentUserId) {
              await supabase.from('profiles').delete().eq('id', currentUserId)
            }
          } catch {
            // ignore
          }

          // C. If user could not be deleted from auth.users via admin API or RPC:
          // Wipe profile details and mark is_deleted: true. We do NOT scramble the password,
          // so the user can re-register or reclaim their account without being blocked in auth.users.
          if (!authDeleted) {
            try {
              await supabase.auth.updateUser({
                data: {
                  full_name: '',
                  student_id: '',
                  role: 'student',
                  is_deleted: true,
                  deleted_at: new Date().toISOString(),
                },
              })
            } catch {
              // ignore
            }
          }

          // D. Sign out from Supabase Auth
          try {
            await supabase.auth.signOut()
          } catch {
            // ignore
          }
        }

        // 3. Clear all client-side data
        try {
          localStorage.removeItem('campusbite-dev-role')
          localStorage.removeItem('campusbite-cart')
          sessionStorage.clear()
          window.dispatchEvent(new CustomEvent('campusbite:cart-reset'))
        } catch {
          // ignore
        }

        setProfile(null)
        setSession(null)
        setProfileError('')
        return { authDeleted, authErrorMsg }
      },
    }),
    [session, profile, profileError, loading]
  )


  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAuth() {
  const value = useContext(Context)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
