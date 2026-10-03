import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AuthResponse, User } from '../utils/types';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
}

const ACCESS_KEY = 'lms.access_token';
const REFRESH_KEY = 'lms.refresh_token';
const USER_KEY = 'lms.user';

function loadState(): AuthState {
  try {
    return {
      user: JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'),
      accessToken: localStorage.getItem(ACCESS_KEY),
      refreshToken: localStorage.getItem(REFRESH_KEY),
      hydrated: true,
    };
  } catch {
    return { user: null, accessToken: null, refreshToken: null, hydrated: true };
  }
}

const initialState: AuthState = loadState();

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<AuthResponse>) {
      state.user = action.payload.user;
      state.accessToken = action.payload.access_token;
      state.refreshToken = action.payload.refresh_token;
      localStorage.setItem(ACCESS_KEY, action.payload.access_token);
      localStorage.setItem(REFRESH_KEY, action.payload.refresh_token);
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload.user));
    },
    setUser(state, action: PayloadAction<User>) {
      state.user = action.payload;
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload));
    },
    clearAuth(state) {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    },
  },
});

export const { setAuth, setUser, clearAuth } = authSlice.actions;
export default authSlice.reducer;
