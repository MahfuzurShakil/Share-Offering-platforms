'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiRequestError } from '@/lib/api/client';
import { useApiQuery } from '@/lib/api/use-api';
import {
  allows,
  type Ability,
  type AccessLevel,
  type PermissionModule,
} from '@/lib/domain/permissions';

/**
 * Who is signed in, for the browser.
 *
 * The prototype simulated this with a role dropdown in the topbar. This asks
 * the server — `/api/v1/auth/me` — and the levels it answers with are the same
 * `role_permissions` rows the server checks on every request, so a menu can
 * never offer a screen the API would refuse.
 *
 * The shape is kept the same as the simulator's on purpose (`role`, `userName`,
 * `userId`), so the forty screens that read it change by their import line and
 * nothing else. What they gain is `can()`, which asks a real question.
 */

export interface SessionUser {
  id: string;
  name: string;
  role: string;
}

interface SessionValue {
  /** undefined while the first request is in flight */
  loading: boolean;
  signedIn: boolean;
  userId: string;
  userName: string;
  role: string;
  /** the projects this user is scoped to; empty means all of them */
  projectIds: string[];
  permissions: Partial<Record<PermissionModule, AccessLevel>>;
  can: (module: PermissionModule, ability?: Ability) => boolean;
  levelFor: (module: PermissionModule) => AccessLevel;
  signOut: (everywhere?: boolean) => Promise<void>;
  refresh: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

interface MeResponse {
  kind: 'staff' | 'customer';
  user?: SessionUser;
  project_ids?: string[];
  permissions?: Record<string, AccessLevel>;
  customer_id?: string;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const query = useApiQuery<MeResponse | null>(
    ['auth', 'me'],
    async (signal) => {
      try {
        return await api.get<MeResponse>('/auth/me', undefined, signal);
      } catch (error) {
        // not signed in is an answer, not a failure worth retrying
        if (error instanceof ApiRequestError && error.isUnauthenticated) return null;
        throw error;
      }
    },
    { staleTime: 60_000 },
  );

  const me = query.data ?? null;
  const permissions = useMemo(
    () => (me?.permissions ?? {}) as Partial<Record<PermissionModule, AccessLevel>>,
    [me],
  );

  const levelFor = useCallback(
    (module: PermissionModule): AccessLevel => permissions[module] ?? 'none',
    [permissions],
  );

  const can = useCallback(
    (module: PermissionModule, ability: Ability = 'view') => allows(levelFor(module), ability),
    [levelFor],
  );

  const signOut = useCallback(
    async (everywhere = false) => {
      try {
        await api.post(`/auth/logout${everywhere ? '?everywhere=1' : ''}`);
      } finally {
        router.replace('/login');
        router.refresh();
      }
    },
    [router],
  );

  const value = useMemo<SessionValue>(
    () => ({
      loading: query.isLoading,
      signedIn: Boolean(me?.user),
      userId: me?.user?.id ?? '',
      userName: me?.user?.name ?? '',
      role: me?.user?.role ?? '',
      projectIds: me?.project_ids ?? [],
      permissions,
      can,
      levelFor,
      signOut,
      refresh: () => query.refetch(),
    }),
    [query, me, permissions, can, levelFor, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The signed-in user.
 *
 * Outside a provider — which only happens in a test rendering one piece — this
 * answers "nobody, and allowed nothing" rather than throwing, so a component
 * can be rendered on its own.
 */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value) return value;
  return {
    loading: false,
    signedIn: false,
    userId: '',
    userName: '',
    role: '',
    projectIds: [],
    permissions: {},
    can: () => false,
    levelFor: () => 'none',
    signOut: async () => {},
    refresh: () => {},
  };
}
