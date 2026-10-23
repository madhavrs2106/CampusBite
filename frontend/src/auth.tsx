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
  role: 'student' | 'canteen_staff' | 'admin'
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
  signUp: (email: string, password: string, name: string, studentId: string) => Promise<boolean>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (fullName: string, studentId: string) => Promise<void>
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

    const meta = s.user?.user_metadata ?? {}
    const fallbackName =
      (meta.full_name as string) ||
      (meta.name as string) ||
      (s.user?.email ? s.user.email.split('@')[0] : 'Campus Student')
    const fallbackStudentId = (meta.student_id as string) || null

    try {
      const r = await fetch(`${apiUrl}/api/me`, {
        headers: { Authorization: `Bearer ${s.access_token}` },
      })
      if (r.ok) {
        const data = (await r.json()) as Profile
        setProfile({
          ...data,
          full_name: data.full_name && data.full_name.trim() ? data.full_name : fallbackName,
          student_id: data.student_id ? data.student_id : fallbackStudentId,
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
      role: (meta.role as Profile['role']) || 'student',
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
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      signUp: async (email, password, name, studentId) => {
        if (!supabase) throw new Error('Add Supabase credentials to frontend/.env.local first.')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, student_id: studentId } },
        })
        if (error) throw error
        return !data.session
      },
      signOut: async () => {
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
