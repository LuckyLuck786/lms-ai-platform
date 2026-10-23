import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { setAuth } from '../../store/authSlice';
import { useAppDispatch } from '../../store/hooks';
import { AuthResponse } from '../../utils/types';
import { Alert } from './ui';

/**
 * "Sign in with Google" (Google Identity Services). Renders nothing until the
 * backend reports a Google client id, so deployments without one simply do
 * not show the button. Google returns a signed ID token, which the backend
 * verifies before signing the user in (or creating their account).
 */

interface GoogleIdApi {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export default function GoogleSignIn({ text = 'signin_with' }: { text?: 'signin_with' | 'signup_with' }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: async () => (await api.get<{ google_client_id: string | null }>('/auth/providers')).data,
    staleTime: Infinity,
  });
  const clientId = providers.data?.google_client_id;

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const { data } = await api.post<AuthResponse>('/auth/google', { credential });
              dispatch(setAuth(data));
              navigate('/');
            } catch (err) {
              setError(apiErrorMessage(err));
            }
          },
        });
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline',
          size: 'large',
          text,
          width: 320,
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, dispatch, navigate, text]);

  if (!clientId) return null;
  return (
    <div className="space-y-2">
      <div ref={holder} className="flex justify-center" />
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
