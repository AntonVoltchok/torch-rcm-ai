/**
 * Who is using the demo and which location they are looking at.
 *
 * The API resolves the role from the `X-Torch-User` header; this store only decides which header to send
 * (demo user switcher) and remembers the last location (convenience, localStorage). The user list mirrors
 * the four seeded users in docs/spec/04-seed.md — there is no auth in the demo.
 */
import { useSyncExternalStore } from 'react'
import type { Role } from '@/api/schema'
import { readJson, writeJson } from '@/lib/storage'

export interface DemoUser {
  id: 'usr_dana' | 'usr_morgan' | 'usr_lee' | 'usr_tasha'
  name: string
  role: Role
  title: string
}

export const USERS: readonly DemoUser[] = [
  { id: 'usr_dana', name: 'Dana S.', role: 'billing', title: 'Billing coordinator' },
  { id: 'usr_morgan', name: 'Dr. Morgan', role: 'owner', title: 'Practice owner' },
  { id: 'usr_lee', name: 'Dr. Lee', role: 'dentist', title: 'Associate dentist' },
  { id: 'usr_tasha', name: 'Tasha P.', role: 'front_desk', title: 'Front desk' },
]

export const LOCATIONS = [
  { id: 'all', name: 'All locations' },
  { id: 'loc_downtown', name: 'Downtown' },
  { id: 'loc_riverside', name: 'Riverside' },
] as const
export type LocationId = (typeof LOCATIONS)[number]['id']

export interface Session {
  userId: DemoUser['id']
  locationId: LocationId
}

const KEY = 'torch.session'
const isUserId = (v: unknown): v is DemoUser['id'] => USERS.some((u) => u.id === v)
const isLocationId = (v: unknown): v is LocationId => LOCATIONS.some((l) => l.id === v)

function load(): Session {
  return readJson<Session>(
    KEY,
    (raw) => {
      const r = raw as Partial<Record<keyof Session, unknown>>
      return { userId: isUserId(r.userId) ? r.userId : 'usr_dana', locationId: isLocationId(r.locationId) ? r.locationId : 'all' }
    },
    { userId: 'usr_dana', locationId: 'all' },
  )
}

let state: Session = load()
const listeners = new Set<() => void>()

export const session = {
  get: (): Session => state,
  user: (): DemoUser => USERS.find((u) => u.id === state.userId) ?? (USERS[0] as DemoUser),
  set(patch: Partial<Session>): void {
    state = { ...state, ...patch }
    writeJson(KEY, state)
    listeners.forEach((l) => {
      l()
    })
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Location as an API param (`undefined` = all). */
  locationParam: (): string | undefined => (state.locationId === 'all' ? undefined : state.locationId),
}

export function useSession(): Session {
  return useSyncExternalStore(session.subscribe, session.get, session.get)
}

export function useCurrentUser(): DemoUser {
  const { userId } = useSession()
  return USERS.find((u) => u.id === userId) ?? (USERS[0] as DemoUser)
}

export const canSee = {
  cash: (role: Role) => role === 'owner',
  settings: (role: Role) => role === 'owner' || role === 'billing',
  clock: (role: Role) => role === 'owner',
}
