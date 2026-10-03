import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import { Role } from '../utils/types';

interface Props {
  /** If provided, the user must hold at least one of these roles. */
  allow?: Role[];
}

/** Guards private routes; optionally enforces RBAC at the UI layer. */
export default function ProtectedRoute({ allow }: Props) {
  const { user, hydrated } = useAppSelector((s) => s.auth);

  if (!hydrated || !user) return <Navigate to="/login" replace />;
  if (allow && !user.roles.some((r) => allow.includes(r))) return <Navigate to="/" replace />;
  return <Outlet />;
}
