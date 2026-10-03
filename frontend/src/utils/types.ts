export type Role = 'student' | 'instructor' | 'admin';

export interface User {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  roles: Role[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  thumbnail_url: string | null;
  price: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  created_at: string;
  instructor_name?: string;
  enrollment_count?: number;
}

export interface Lecture {
  id: string;
  module_id: string;
  title: string;
  video_url: string | null;
  transcript?: string | null;
  duration_seconds: number | null;
  order_index: number;
  resource_urls: string[] | null;
}

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  lectures: Lecture[];
  quizzes: { id: string; module_id: string; title: string; question_count: number }[];
}

export interface CourseDetail extends Course {
  instructor_id: string;
  modules: CourseModule[];
  assignments: {
    id: string;
    title: string;
    instructions: string | null;
    due_date: string | null;
  }[];
}

export interface Enrollment {
  id: string;
  enrolled_at: string;
  progress_percent: string;
  course_id: string;
  title: string;
  category: string | null;
  difficulty: string | null;
  thumbnail_url: string | null;
  status: string;
  instructor_name: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; field?: string };
}

// ---- Phase 2: learning core ------------------------------------------------

export interface LectureProgress {
  watched_seconds: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface Note {
  id: string;
  lecture_id: string;
  timestamp_seconds: number;
  content: string;
  created_at: string;
}

export interface Bookmark {
  id: string;
  timestamp_seconds: number;
  created_at: string;
}

export interface QuizOption {
  id: string;
  option_text: string;
  is_correct?: boolean;
}

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: 'mcq' | 'multi_select' | 'short_answer';
  order_index: number;
  options: QuizOption[];
}

export interface Quiz {
  id: string;
  module_id: string;
  title: string;
  show_answers: boolean;
  questions: QuizQuestion[];
}

export interface AttemptSubmission {
  attempt_id: string;
  score: number | null;
  per_question: { question_id: string; is_correct: boolean | null }[];
}

export interface Assignment {
  id: string;
  title: string;
  instructions: string | null;
  rubric: { criterion: string; weight: number }[] | null;
  due_date: string | null;
  my_submission_id?: string | null;
  my_submitted_at?: string | null;
  my_grade?: string | null;
  my_feedback?: string | null;
  submission_count?: number;
}

export interface Certificate {
  id: string;
  issued_at: string;
  certificate_url: string | null;
  course_title: string;
}

export interface Streak {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
}

export interface Badge {
  id: number;
  name: string;
  description: string | null;
  earned_at: string;
}

// ---- Phase 4: admin, discussions, notifications ---------------------------

export interface AdminOverview {
  total_users: number;
  active_users: number;
  dau: number;
  total_courses: number;
  approved_courses: number;
  pending_courses: number;
  total_enrollments: number;
  completion_rate: number;
  revenue: number;
  flagged_posts: number;
}

export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  roles: string[];
  enrollment_count: number;
}

export interface PendingCourse extends Course {
  instructor_name: string;
  module_count: number;
}

export interface DiscussionThread {
  id: string;
  course_id: string;
  title: string;
  created_at: string;
  created_by_name: string;
  post_count: number;
  last_activity_at: string | null;
}

export interface DiscussionPost {
  id: string;
  content: string;
  is_flagged: boolean;
  created_at: string;
  author_name: string;
  author_id: string;
  user_id: string;
}

export interface Announcement {
  id: string;
  course_id: string;
  content: string;
  created_at: string;
  posted_by_name: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}
