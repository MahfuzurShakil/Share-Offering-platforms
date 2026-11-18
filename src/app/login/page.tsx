'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, TextInput } from '@/components/ui/Field';
import { api, fieldErrorsOf, messageOf } from '@/lib/api/client';

/**
 * Staff sign-in.
 *
 * Investors sign in on their own portal with a code sent to their phone
 * (`/customer/login`); this is the office door, and it asks for a password.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = params.get('next') || '/admin';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await api.post('/auth/login', { identifier: identifier.trim(), password });
      // whatever the last person in this tab could see is not what this one can
      queryClient.clear();
      router.replace(next.startsWith('/') ? next : '/admin');
      router.refresh();
    } catch (err) {
      setError(messageOf(err));
      setFields(fieldErrorsOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Admin Portal</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to continue.</p>
        </div>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Phone or email" required error={fields.identifier}>
              <TextInput
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="01711223344"
                autoComplete="username"
                autoFocus
                invalid={Boolean(fields.identifier)}
              />
            </Field>

            <Field label="Password" required error={fields.password}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                invalid={Boolean(fields.password)}
              />
            </Field>

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy || !identifier || !password}>
              <LogIn className="size-4" /> {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-ink-muted">
          An investor? Sign in on the{' '}
          <a href="/customer/login" className="font-medium text-admin-700 hover:underline">
            Customer Portal
          </a>
          .
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
