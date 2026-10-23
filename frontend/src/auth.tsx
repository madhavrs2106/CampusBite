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
    const fallbackName =
      (meta.full_name as string) ||
      (meta.name as string) ||
      (s.user?.email ? s.user.email.split('@')[0] : 'Campus Student')
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
        setProfile({
          ...data,
          full_name: data.full_name && data.full_name.trim() ? data.full_name : fallbackName,
          student_id: data.student_id ? data.student_id : fallbackStudentId,
          role: devRole || data.role || 'student',
        })
        setProfileError('')
        return
      }
    } catch {
      // Backend /api/me might be loading or offline
    }

    // Reliable fallback to auth session metadata so student name and roll no always show
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        if (data?.user?.user_metadata?.is_deleted) {
          await supabase.auth.signOut().catch(() => {})
          throw new Error('This account has been permanently deleted. Please create a new account.')
        }
      },
      signUp: async (email, password, name, studentId, userType = 'student') => {
        if (!supabase) throw new Error('Add Supabase credentials to frontend/.env.local first.')
        const role = userType
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              student_id: studentId,
              role: role,
              user_type: userType,
            },
          },
        })
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
        if (supabase) {
          const { error } = await supabase.auth.signOut()
          if (error) throw error
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
        setProfile(prev =>
          prev
            ? { ...prev, role: newRole }
            : {
                id: session?.user?.id ?? 'demo-staff-user',
                full_name: 'Canteen Staff',
                student_id: null,
                role: newRole,
                account_status: 'active',
                created_at: new Date().toISOString(),
              }
        )
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

          // C. If user is still in auth.users (missing service_role key or RPC not migrated):
          // Scramble password to an unguessable string so user CANNOT log in again with their password,
          // and wipe metadata so name, student ID and details are deleted.
          if (!authDeleted) {
            try {
              const unguessablePassword = `DEL_${crypto.randomUUID()}_${Date.now()}!${Math.random().toString(36)}#Aa`
              await supabase.auth.updateUser({
                password: unguessablePassword,
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
