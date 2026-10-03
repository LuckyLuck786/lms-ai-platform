import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import Login from '../pages/auth/Login';
import Register from '../pages/auth/Register';
import StudentDashboard from '../pages/dashboard/StudentDashboard';
import InstructorDashboard from '../pages/dashboard/InstructorDashboard';
import AdminDashboard from '../pages/admin-panel/AdminDashboard';
import CourseCatalog from '../pages/course-catalog/CourseCatalog';
import CourseDetail from '../pages/course-catalog/CourseDetail';
import CoursePlayer from '../pages/course-player/CoursePlayer';
import QuizTake from '../pages/quizzes/QuizTake';
import { useAppSelector } from '../store/hooks';

function HomeRedirect() {
  const user = useAppSelector((s) => s.auth.user);
  if (user?.roles.includes('admin')) return <Navigate to="/admin" replace />;
  if (user?.roles.includes('instructor') && !user.roles.includes('student')) {
    return <Navigate to="/instructor" replace />;
  }
  return <StudentDashboard />;
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      // Public
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/catalog', element: <CourseCatalog /> },
      { path: '/catalog/:id', element: <CourseDetail /> },

      // Authenticated
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/', element: <HomeRedirect /> },
          { path: '/learn/:courseId/:lectureId', element: <CoursePlayer /> },
          { path: '/quiz/:quizId', element: <QuizTake /> },
        ],
      },
      {
        element: <ProtectedRoute allow={['instructor', 'admin']} />,
        children: [{ path: '/instructor', element: <InstructorDashboard /> }],
      },
      {
        element: <ProtectedRoute allow={['admin']} />,
        children: [{ path: '/admin', element: <AdminDashboard /> }],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function AppRoutes() {
  return <RouterProvider router={router} />;
}
