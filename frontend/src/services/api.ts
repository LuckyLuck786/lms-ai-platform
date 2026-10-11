import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { store } from '../store/store';
import { clearAuth, setAuth } from '../store/authSlice';
import { ApiErrorBody, AuthResponse } from '../utils/types';
import { demoAdapter, isDemoMode } from './demo';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Origin that serves uploaded media (`/uploads/*`) — the API host, not the SPA host. */
export const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    return '';
  }
})();

/**
 * Uploaded lecture material is stored as a backend-relative path
 * (`/uploads/lectures/<id>.mp4`). Left relative, the browser would fetch it
 * from the SPA origin (where it resolves to the app shell), so media URLs are
 * always resolved against the API origin. Absolute and object URLs pass
 * through untouched, and demo mode keeps its in-browser blob URLs.
 */
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  if (DEMO_MODE) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** True when no backend is configured and API calls are served from the browser. */
export const DEMO_MODE = isDemoMode();

// The default instance also gets the demo adapter so the token-refresh call
// below — which intentionally bypasses the shared interceptors — stays offline.
if (DEMO_MODE) axios.defaults.adapter = demoAdapter;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  adapter: DEMO_MODE ? demoAdapter : undefined,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = store.getState().auth.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<AuthResponse> | null = null;

/** On 401, transparently refresh the access token once, then retry. */
api.interceptors.response.use(
  (res) => {
    // Behind a static host, /api/* can silently resolve to the SPA shell
    // (HTML with status 200). Treat that as a failed API call so queries
    // surface a proper error instead of crashing on undefined data.
    const contentType = String(res.headers?.['content-type'] ?? '');
    if (res.config.responseType !== 'blob' && !contentType.includes('application/json')) {
      return Promise.reject(
        new AxiosError(
          'API returned a non-JSON response — is the backend connected?',
          'EBADRESPONSE',
          res.config,
          res.request,
          res,
        ),
      );
    }
    return res;
  },
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const refreshToken = store.getState().auth.refreshToken;

    if (error.response?.status === 401 && original && !original._retry && refreshToken) {
      original._retry = true;
      try {
        refreshing =
          refreshing ??
          axios
            .post<AuthResponse>(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
            .then((r) => r.data)
            .finally(() => {
              refreshing = null;
            });
        const next = await refreshing;
        store.dispatch(setAuth(next));
        original.headers.Authorization = `Bearer ${next.access_token}`;
        return api.request(original);
      } catch {
        store.dispatch(clearAuth());
      }
    }

    if (error.response?.status === 401 && !original?._retry) {
      store.dispatch(clearAuth());
    }
    return Promise.reject(error);
  },
);

/** Extracts the standard error envelope, with a friendly fallback. */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (err.code === 'ECONNABORTED') return 'Request timed out — is the API running?';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
