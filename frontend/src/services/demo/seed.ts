import {
  Announcement,
  AppNotification,
  Assignment,
  Badge,
  Certificate,
  CourseDetail,
  DiscussionPost,
  DiscussionThread,
  Enrollment,
  Note,
  Quiz,
  Role,
  Streak,
  User,
} from '../../utils/types';

/**
 * In-memory dataset backing the browser demo mode (see `demo/server.ts`).
 *
 * It mirrors the shapes the FastAPI backend returns so every screen renders
 * identically whether a real API is configured or not. Nothing here persists:
 * reloading the page restores this baseline.
 */

export const DEMO_PASSWORD = 'DemoPass123!';

export interface DemoAccount extends User {
  password: string;
  is_active: boolean;
  created_at: string;
}

export interface NotificationRecord extends AppNotification {
  user_id: string;
}

export interface CertificateRecord extends Certificate {
  user_id: string;
}

export interface EnrollmentRecord extends Enrollment {
  user_id: string;
}

export interface DiscussionPostRecord extends DiscussionPost {
  thread_id: string;
  course_id: string;
}

export interface AssignmentRecord extends Assignment {
  course_id: string;
}

export interface BookmarkRecord {
  id: string;
  lecture_id: string;
  timestamp_seconds: number;
  created_at: string;
}

export interface SubmissionRecord {
  id: string;
  assignment_id: string;
  user_id: string;
  submitted_at: string;
  grade: string | null;
  feedback: string | null;
  file_name: string;
}

export interface AttemptRecord {
  id: string;
  quiz_id: string;
  user_id: string;
  score: number | null;
  created_at: string;
}

export interface ChatSessionRecord {
  id: string;
  course_id: string;
  user_id: string;
  mode: string;
  created_at: string;
}

export interface ChatMessageRecord {
  id: string;
  session_id: string;
  sender: 'user' | 'ai';
  content: string;
  sources: { lecture_id: string; lecture_title: string | null; timestamp_seconds: number | null }[] | null;
  created_at: string;
}

export interface ProgressRecord {
  watched_seconds: number;
  completed: boolean;
  last_watched_at: string | null;
}

export interface DemoState {
  /** question_id -> correct option ids; never leaves the "server" side. */
  answerKey: Record<string, string[]>;
  accounts: DemoAccount[];
  currentUserId: string | null;
  courses: CourseDetail[];
  enrollments: EnrollmentRecord[];
  /** Keyed by `${userId}:${lectureId}`. */
  progress: Record<string, ProgressRecord>;
  notes: Note[];
  bookmarks: BookmarkRecord[];
  quizzes: Quiz[];
  attempts: AttemptRecord[];
  assignments: AssignmentRecord[];
  submissions: SubmissionRecord[];
  threads: DiscussionThread[];
  posts: DiscussionPostRecord[];
  announcements: Announcement[];
  notifications: NotificationRecord[];
  streaks: Record<string, Streak>;
  badges: Badge[];
  certificates: CertificateRecord[];
  sessions: ChatSessionRecord[];
  messages: ChatMessageRecord[];
}

const DAY = 86_400_000;
const NOW = Date.now();

const iso = (daysAgo: number, hourOffset = 0): string =>
  new Date(NOW - daysAgo * DAY + hourOffset * 3_600_000).toISOString();

let seq = 0;
/**
 * Ids for records created during a session. The timestamp keeps them from
 * colliding with the hand-written seed ids (and with each other if two
 * records are minted in the same millisecond).
 */
export const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** Public CC sample clips, ranged so the player's resume-from-position works. */
const CLIPS = {
  bunny: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
  jellyfish:
    'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4',
  sintel: 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
} as const;

// ---------------------------------------------------------------------------
// Transcript corpus — drives the AI tutor, summaries, flashcards and study plans.
// ---------------------------------------------------------------------------

const T = {
  react:
    'React components are reusable functions that return JSX. Props are read-only inputs passed from a parent to a child component, and a component must never mutate them. Composition beats inheritance: build small components and nest them instead of subclassing a big one. State belongs in the parent whenever siblings need to share data, and stays local whenever a single component owns it. A controlled input ties its value to state so the rendered form always mirrors the data model, which removes an entire class of desynchronisation bugs.',
  redux:
    'Redux Toolkit standardises the store into slices. You call createSlice, describe your state transitions as immutable reducers, and dispatch actions from components. Redux Toolkit Query caches server data and lets you invalidate it by tag after a mutation. Prefer local state or React context until you genuinely need state shared across distant parts of the tree, because a global store that owns everything is harder to reason about than one that owns a little.',
  rest:
    'A REST API maps HTTP verbs onto resource operations: GET reads, POST creates, PUT replaces and DELETE removes. Keep every route under a versioned prefix such as /api/v1, validate each input at the boundary, and return one consistent error envelope containing a code, a human readable message and the offending field. Stateless JWT middleware verifies the signature, checks the expiry, and attaches the user id to the request before your handler runs.',
  sql:
    'A B-tree index speeds up equality and range predicates because it keeps keys in sorted order. GIN indexes serve JSONB containment queries and full text search. Always confirm an index is actually used by running EXPLAIN ANALYZE and reading the plan for sequential scans on large tables. Index every foreign key column, because joins and cascading deletes both rely on those lookups, and index the columns your WHERE and ORDER BY clauses filter on.',
  overfit:
    'A model overfits when it memorises the training set instead of learning the underlying pattern. You will see training accuracy climb while validation accuracy stalls or falls. Countermeasures include L1 and L2 regularisation, dropout layers, early stopping on a validation curve, and simply collecting more data. A useful diagnostic is to plot both curves on the same axes and look for the gap between them widening.',
  k8s:
    'A Kubernetes cluster reconciles desired state against observed state in a continuous control loop. Pods are the smallest schedulable unit and are described declaratively in YAML. Deployments manage replica sets and rolling updates, Services give a stable virtual IP in front of changing pods, and Ingress routes external HTTP traffic into the cluster. Always set resource requests and limits so the scheduler has something to reason about.',
};

// ---------------------------------------------------------------------------

export function createDemoState(): DemoState {
  const account = (
    id: string,
    full_name: string,
    email: string,
    roles: Role[],
    ageDays: number,
    is_active = true,
  ): DemoAccount => ({
    id,
    full_name,
    email,
    avatar_url: null,
    role: roles[roles.length - 1],
    roles,
    password: DEMO_PASSWORD,
    is_active,
    created_at: iso(ageDays),
  });

  const accounts: DemoAccount[] = [
    account('u-student', 'Riya Sharma', 'student@vertexon.demo', ['student'], 75),
    account('u-student2', 'Kabir Mehta', 'student2@vertexon.demo', ['student'], 60),
    account('u-instructor', 'Dr. Ananya Rao', 'instructor@vertexon.demo', ['instructor'], 200),
    account('u-instructor2', 'Marcus Webb', 'instructor2@vertexon.demo', ['instructor'], 180),
    account('u-admin', 'Meera Iyer', 'admin@vertexon.demo', ['student', 'admin'], 210),
    // Extra roster rows so the admin user table looks like a real platform.
    account('u-3', 'Daniel Okafor', 'daniel@vertexon.demo', ['student'], 52),
    account('u-4', 'Sofia Marchetti', 'sofia@vertexon.demo', ['student'], 48, false),
    account('u-5', 'Yusuf Karim', 'yusuf@vertexon.demo', ['student'], 41),
    account('u-6', 'Lin Wei', 'lin@vertexon.demo', ['instructor'], 120),
    account('u-7', 'Priya Nair', 'priya@vertexon.demo', ['student'], 33),
    account('u-8', 'Tom Bergstrom', 'tom@vertexon.demo', ['student'], 21),
  ];

  const courses: CourseDetail[] = [
    {
      id: 'c-ml',
      instructor_id: 'u-instructor',
      title: 'Foundations of Machine Learning',
      description:
        'Supervised and unsupervised learning from first principles: loss functions, regularisation, cross-validation and the evaluation traps that trip up most first projects.',
      category: 'Data Science',
      difficulty: 'intermediate',
      thumbnail_url: null,
      price: '49.00',
      status: 'approved',
      created_at: iso(120),
      instructor_name: 'Dr. Ananya Rao',
      enrollment_count: 5,
      modules: [
        {
          id: 'm-ml-1',
          course_id: 'c-ml',
          title: 'Module 1: Learning fundamentals',
          order_index: 0,
          lectures: [
            {
              id: 'l-ml-1',
              module_id: 'm-ml-1',
              title: 'What a model actually learns',
              video_url: CLIPS.bunny,
              transcript: T.overfit,
              duration_seconds: 596,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-ml-2',
              module_id: 'm-ml-1',
              title: 'Loss functions and gradient descent',
              video_url: CLIPS.jellyfish,
              transcript: T.overfit,
              duration_seconds: 734,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
        {
          id: 'm-ml-2',
          course_id: 'c-ml',
          title: 'Module 2: Generalisation',
          order_index: 1,
          lectures: [
            {
              id: 'l-ml-3',
              module_id: 'm-ml-2',
              title: 'Regularisation and early stopping',
              video_url: CLIPS.sintel,
              transcript: T.overfit,
              duration_seconds: 642,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-ml-4',
              module_id: 'm-ml-2',
              title: 'Cross-validation done properly',
              video_url: CLIPS.bunny,
              transcript: T.overfit,
              duration_seconds: 689,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [{ id: 'q-ml', module_id: 'm-ml-2', title: 'Overfitting check', question_count: 3 }],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-sql',
      instructor_id: 'u-instructor2',
      title: 'SQL for Analytics',
      description:
        'Write queries that answer real business questions. Window functions, CTEs, indexing strategy and query-plan literacy, with a heavy practical bias.',
      category: 'Data Science',
      difficulty: 'beginner',
      thumbnail_url: null,
      price: '0.00',
      status: 'approved',
      created_at: iso(96),
      instructor_name: 'Marcus Webb',
      enrollment_count: 12,
      modules: [
        {
          id: 'm-sql-1',
          course_id: 'c-sql',
          title: 'Module 1: Querying fundamentals',
          order_index: 0,
          lectures: [
            {
              id: 'l-sql-1',
              module_id: 'm-sql-1',
              title: 'Indexes and query plans',
              video_url: CLIPS.jellyfish,
              transcript: T.sql,
              duration_seconds: 780,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-sql-2',
              module_id: 'm-sql-1',
              title: 'Window functions in anger',
              video_url: CLIPS.sintel,
              transcript: T.sql,
              duration_seconds: 810,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [
            { id: 'q-sql', module_id: 'm-sql-1', title: 'Indexing fundamentals', question_count: 3 },
          ],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-alg',
      instructor_id: 'u-instructor',
      title: 'Linear Algebra Essentials',
      description:
        'Vectors, matrices, subspaces and the singular value decomposition — taught the way machine-learning courses actually use it.',
      category: 'Mathematics',
      difficulty: 'beginner',
      thumbnail_url: null,
      price: '0.00',
      status: 'approved',
      created_at: iso(150),
      instructor_name: 'Dr. Ananya Rao',
      enrollment_count: 9,
      modules: [
        {
          id: 'm-alg-1',
          course_id: 'c-alg',
          title: 'Module 1: The objects',
          order_index: 0,
          lectures: [
            {
              id: 'l-alg-1',
              module_id: 'm-alg-1',
              title: 'Vectors, spans and subspaces',
              video_url: CLIPS.bunny,
              transcript:
                'A vector is an arrow in some space, and a span is the set of every vector you can reach by adding scaled copies of a collection. A subspace is any span that contains the zero vector and is closed under addition and scalar multiplication. Rank counts the dimensions you actually control; reducing a matrix to row-echelon form reveals its rank without computing determinants.',
              duration_seconds: 705,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-alg-2',
              module_id: 'm-alg-1',
              title: 'The singular value decomposition',
              video_url: CLIPS.jellyfish,
              transcript:
                'The singular value decomposition factorises any matrix as U times Sigma times V transpose. The singular values on the diagonal of Sigma are non-negative and ordered, and they measure how much stretch each direction receives. Truncating to the largest k singular values gives the best rank-k approximation in the Frobenius norm, which is exactly why SVD powers dimensionality reduction and pseudo-inverses.',
              duration_seconds: 830,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-pm',
      instructor_id: 'u-instructor2',
      title: 'Product Management Foundations',
      description:
        'Discovery, prioritisation and stakeholder communication for people who own a product and no budget to hide behind.',
      category: 'Business',
      difficulty: 'intermediate',
      thumbnail_url: null,
      price: '29.00',
      status: 'approved',
      created_at: iso(64),
      instructor_name: 'Marcus Webb',
      enrollment_count: 6,
      modules: [
        {
          id: 'm-pm-1',
          course_id: 'c-pm',
          title: 'Module 1: Discovery',
          order_index: 0,
          lectures: [
            {
              id: 'l-pm-1',
              module_id: 'm-pm-1',
              title: 'Problem framing that survives contact',
              video_url: CLIPS.sintel,
              transcript:
                'Good problem framing names a specific user, a specific moment of friction and a measurable outcome. Vague statements like "improve engagement" cannot be falsified, so they cannot be tested. Write the assumption you are betting on, then go find the cheapest experiment that could prove you wrong.',
              duration_seconds: 660,
              order_index: 0,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-design',
      instructor_id: 'u-instructor',
      title: 'Design Systems in Practice',
      description:
        'Tokens, components and the governance model that stops a design system from rotting six months after launch.',
      category: 'Design',
      difficulty: 'intermediate',
      thumbnail_url: null,
      price: '39.00',
      status: 'approved',
      created_at: iso(45),
      instructor_name: 'Dr. Ananya Rao',
      enrollment_count: 3,
      modules: [
        {
          id: 'm-dz-1',
          course_id: 'c-design',
          title: 'Module 1: Foundations',
          order_index: 0,
          lectures: [
            {
              id: 'l-dz-1',
              module_id: 'm-dz-1',
              title: 'Tokens, themes and dark mode',
              video_url: CLIPS.jellyfish,
              transcript:
                'A design token is a named design decision stored separately from the component that consumes it. Naming by role rather than by literal value — surface, on-surface, border-subtle — means a theme swap changes every binding at once. Semantic names survive redesigns; hex codes do not.',
              duration_seconds: 612,
              order_index: 0,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-dl',
      instructor_id: 'u-instructor2',
      title: 'Applied Deep Learning',
      description:
        'Convolutional and sequence architectures, transfer learning, and how to tell whether your model is broken or your data is.',
      category: 'Computer Science',
      difficulty: 'advanced',
      thumbnail_url: null,
      price: '79.00',
      status: 'approved',
      created_at: iso(30),
      instructor_name: 'Marcus Webb',
      enrollment_count: 2,
      modules: [
        {
          id: 'm-dl-1',
          course_id: 'c-dl',
          title: 'Module 1: Architectures',
          order_index: 0,
          lectures: [
            {
              id: 'l-dl-1',
              module_id: 'm-dl-1',
              title: 'Convolution and receptive fields',
              video_url: CLIPS.bunny,
              transcript: T.overfit,
              duration_seconds: 900,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-dl-2',
              module_id: 'm-dl-1',
              title: 'Transfer learning and fine-tuning',
              video_url: CLIPS.jellyfish,
              transcript:
                'Transfer learning reuses weights trained on a large dataset and adapts them to a smaller target domain. Freeze early layers, train the head, then unfreeze progressively. Choose a learning rate an order of magnitude lower than from-scratch training, because the optimiser is moving weights that already encode useful structure.',
              duration_seconds: 872,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-rag',
      instructor_id: 'u-instructor',
      title: 'Full-Stack Web Development Bootcamp',
      description:
        'Build and ship modern web applications: React frontends, REST APIs, PostgreSQL, authentication, testing and CI.',
      category: 'Computer Science',
      difficulty: 'intermediate',
      thumbnail_url: null,
      price: '0.00',
      status: 'approved',
      created_at: iso(200),
      instructor_name: 'Dr. Ananya Rao',
      enrollment_count: 8,
      modules: [
        {
          id: 'm-rag-1',
          course_id: 'c-rag',
          title: 'Module 1: Frontend foundations',
          order_index: 0,
          lectures: [
            {
              id: 'l-rag-1',
              module_id: 'm-rag-1',
              title: 'React components and props',
              video_url: CLIPS.sintel,
              transcript: T.react,
              duration_seconds: 720,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-rag-2',
              module_id: 'm-rag-1',
              title: 'State management with Redux Toolkit',
              video_url: CLIPS.bunny,
              transcript: T.redux,
              duration_seconds: 900,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
        {
          id: 'm-rag-2',
          course_id: 'c-rag',
          title: 'Module 2: APIs and data',
          order_index: 1,
          lectures: [
            {
              id: 'l-rag-3',
              module_id: 'm-rag-2',
              title: 'Designing REST APIs with Express',
              video_url: CLIPS.jellyfish,
              transcript: T.rest,
              duration_seconds: 840,
              order_index: 0,
              resource_urls: null,
            },
            {
              id: 'l-rag-4',
              module_id: 'm-rag-2',
              title: 'PostgreSQL indexing and query plans',
              video_url: CLIPS.sintel,
              transcript: T.sql,
              duration_seconds: 780,
              order_index: 1,
              resource_urls: null,
            },
          ],
          quizzes: [
            { id: 'q-rag', module_id: 'm-rag-2', title: 'REST API fundamentals', question_count: 3 },
          ],
        },
      ],
      assignments: [],
    },
    {
      id: 'c-k8s',
      instructor_id: 'u-instructor2',
      title: 'Introduction to Kubernetes',
      description:
        'Pods, deployments, services and ingress — the mental model that makes cluster YAML stop looking like ritual.',
      category: 'Computer Science',
      difficulty: 'advanced',
      thumbnail_url: null,
      price: '59.00',
      status: 'pending',
      created_at: iso(4),
      instructor_name: 'Marcus Webb',
      enrollment_count: 0,
      modules: [
        {
          id: 'm-k8s-1',
          course_id: 'c-k8s',
          title: 'Module 1: The control loop',
          order_index: 0,
          lectures: [
            {
              id: 'l-k8s-1',
              module_id: 'm-k8s-1',
              title: 'Desired state and reconciliation',
              video_url: null,
              transcript: T.k8s,
              duration_seconds: 660,
              order_index: 0,
              resource_urls: null,
            },
          ],
          quizzes: [],
        },
      ],
      assignments: [],
    },
  ];

  const enrollments: EnrollmentRecord[] = [
    ['u-student', 'c-ml', '65', 40],
    ['u-student', 'c-sql', '20', 25],
    ['u-student', 'c-alg', '100', 140],
    ['u-student', 'c-pm', '0', 9],
    ['u-student', 'c-rag', '45', 18],
    ['u-student2', 'c-rag', '45', 60],
    ['u-admin', 'c-ml', '30', 70],
  ].map(([user_id, course_id, pct, daysAgo]) => ({
    id: `e-${user_id}-${course_id}`,
    user_id: user_id as string,
    course_id: course_id as string,
    enrolled_at: iso(daysAgo as number),
    progress_percent: pct as string,
    title: '',
    category: null,
    difficulty: null,
    thumbnail_url: null,
    status: 'approved',
    instructor_name: '',
  }));

  // Roster noise so admin metrics and the recommendations engine have volume.
  const crowd = ['u-3', 'u-5', 'u-7', 'u-8', 'u-admin'];
  const crowdCourses = ['c-ml', 'c-rag', 'c-sql', 'c-design', 'c-alg', 'c-pm', 'c-dl'];
  crowd.forEach((user_id, i) => {
    crowdCourses.slice(i % 3).forEach((course_id, j) => {
      enrollments.push({
        id: `e-${user_id}-${course_id}`,
        user_id,
        course_id,
        enrolled_at: iso(20 + i * 3 + j),
        progress_percent: String(((i * 23 + j * 37) % 101)),
        title: '',
        category: null,
        difficulty: null,
        thumbnail_url: null,
        status: 'approved',
        instructor_name: '',
      });
    });
  });

  for (const e of enrollments) {
    const c = courses.find((x) => x.id === e.course_id);
    if (!c) continue;
    e.title = c.title;
    e.category = c.category;
    e.difficulty = c.difficulty;
    e.status = c.status;
    e.instructor_name = c.instructor_name ?? '';
  }

  const quizzes: Quiz[] = [
    {
      id: 'q-rag',
      module_id: 'm-rag-2',
      title: 'REST API fundamentals',
      show_answers: true,
      questions: [
        {
          id: 'q-rag-1',
          question_text: 'Which HTTP verb creates a new resource?',
          question_type: 'mcq',
          order_index: 0,
          options: [
            { id: 'o-r1', option_text: 'GET' },
            { id: 'o-r2', option_text: 'POST' },
            { id: 'o-r3', option_text: 'DELETE' },
          ],
        },
        {
          id: 'q-rag-2',
          question_text: 'Which fields belong in the standard error envelope?',
          question_type: 'multi_select',
          order_index: 1,
          options: [
            { id: 'o-r4', option_text: 'code' },
            { id: 'o-r5', option_text: 'message' },
            { id: 'o-r6', option_text: 'field' },
            { id: 'o-r7', option_text: 'password' },
          ],
        },
        {
          id: 'q-rag-3',
          question_text: 'What does JWT stand for?',
          question_type: 'mcq',
          order_index: 2,
          options: [
            { id: 'o-r8', option_text: 'JSON Web Token' },
            { id: 'o-r9', option_text: 'Joint Wired Transfer' },
            { id: 'o-r10', option_text: 'JSON Web Transfer' },
          ],
        },
      ],
    },
    {
      id: 'q-sql',
      module_id: 'm-sql-1',
      title: 'Indexing fundamentals',
      show_answers: true,
      questions: [
        {
          id: 'q-sql-1',
          question_text: 'Which index type serves JSONB containment queries?',
          question_type: 'mcq',
          order_index: 0,
          options: [
            { id: 'o-s1', option_text: 'B-tree' },
            { id: 'o-s2', option_text: 'GIN' },
            { id: 'o-s3', option_text: 'Hash' },
          ],
        },
        {
          id: 'q-sql-2',
          question_text: 'Which of these should you index?',
          question_type: 'multi_select',
          order_index: 1,
          options: [
            { id: 'o-s4', option_text: 'Foreign key columns' },
            { id: 'o-s5', option_text: 'Columns filtered in WHERE clauses' },
            { id: 'o-s6', option_text: 'Every column in the table' },
          ],
        },
        {
          id: 'q-sql-3',
          question_text: 'Which command shows the real execution plan of a query?',
          question_type: 'mcq',
          order_index: 2,
          options: [
            { id: 'o-s7', option_text: 'EXPLAIN ANALYZE' },
            { id: 'o-s8', option_text: 'SHOW TABLES' },
            { id: 'o-s9', option_text: 'VACUUM FULL' },
          ],
        },
      ],
    },
    {
      id: 'q-ml',
      module_id: 'm-ml-2',
      title: 'Overfitting check',
      show_answers: true,
      questions: [
        {
          id: 'q-ml-1',
          question_text: 'Which signal most strongly suggests your model is overfitting?',
          question_type: 'mcq',
          order_index: 0,
          options: [
            {
              id: 'o-m1',
              option_text: 'Training accuracy rises while validation accuracy stalls',
            },
            { id: 'o-m2', option_text: 'Both accuracies rise together' },
            { id: 'o-m3', option_text: 'Training accuracy is lower than chance' },
          ],
        },
        {
          id: 'q-ml-2',
          question_text: 'Which of these are regularisation techniques?',
          question_type: 'multi_select',
          order_index: 1,
          options: [
            { id: 'o-m4', option_text: 'L2 regularisation' },
            { id: 'o-m5', option_text: 'Dropout' },
            { id: 'o-m6', option_text: 'Early stopping' },
            { id: 'o-m7', option_text: 'Increasing the test set size' },
          ],
        },
        {
          id: 'q-ml-3',
          question_text: 'In one sentence, what does cross-validation buy you?',
          question_type: 'short_answer',
          order_index: 2,
          options: [],
        },
      ],
    },
  ];

  // Answer keys stay on the "server" side — the student payload never sees them.
  const answerKey: Record<string, string[]> = {
    'q-rag-1': ['o-r2'],
    'q-rag-2': ['o-r4', 'o-r5', 'o-r6'],
    'q-rag-3': ['o-r8'],
    'q-sql-1': ['o-s2'],
    'q-sql-2': ['o-s4', 'o-s5'],
    'q-sql-3': ['o-s7'],
    'q-ml-1': ['o-m1'],
    'q-ml-2': ['o-m4', 'o-m5', 'o-m6'],
    'q-ml-3': [],
  };

  const assignments: AssignmentRecord[] = [
    {
      id: 'a-rag-1',
      course_id: 'c-rag',
      title: 'Design a REST API for a blog',
      instructions:
        'Specify resources, verbs, status codes and the error envelope for a multi-author blog with comments. Include at least one nested collection.',
      rubric: [
        { criterion: 'Resource modelling', weight: 40 },
        { criterion: 'Error handling', weight: 30 },
        { criterion: 'Clarity', weight: 30 },
      ],
      due_date: new Date(NOW + 6 * DAY).toISOString(),
    },
    {
      id: 'a-rag-2',
      course_id: 'c-rag',
      title: 'Refactor a component to controlled inputs',
      instructions:
        'Take an uncontrolled form in the starter repo and convert it to controlled inputs.',
      rubric: [{ criterion: 'Correctness', weight: 60 }],
      due_date: new Date(NOW - 2 * DAY).toISOString(),
    },
    {
      id: 'a-sql-1',
      course_id: 'c-sql',
      title: 'Index tuning write-up',
      instructions:
        'Take a slow query, capture EXPLAIN ANALYZE before and after, and explain the change.',
      rubric: [
        { criterion: 'Evidence', weight: 50 },
        { criterion: 'Reasoning', weight: 50 },
      ],
      due_date: new Date(NOW + 12 * DAY).toISOString(),
    },
    {
      id: 'a-ml-1',
      course_id: 'c-ml',
      title: 'Diagnose an overfitting model',
      instructions:
        'Plot training vs validation curves and propose two justified remedies.',
      rubric: [{ criterion: 'Diagnosis', weight: 100 }],
      due_date: new Date(NOW + 3 * DAY).toISOString(),
    },
  ];
  for (const c of courses) c.assignments = assignments.filter((a) => a.course_id === c.id);

  const submissions: SubmissionRecord[] = [
    {
      id: 's-1',
      assignment_id: 'a-rag-2',
      user_id: 'u-student2',
      submitted_at: iso(10),
      grade: '88',
      feedback: 'Clean work — remember to derive the value from state on every render.',
      file_name: 'refactor-routes.tsx',
    },
    {
      id: 's-2',
      assignment_id: 'a-rag-1',
      user_id: 'u-student2',
      submitted_at: iso(30),
      grade: '92',
      feedback: 'Excellent resource modelling.',
      file_name: 'blog-api-spec.pdf',
    },
  ];

  // Watched-seconds are seeded so the derived progress % matches the enrollments.
  const progress: Record<string, ProgressRecord> = {
    'u-student:l-ml-1': { watched_seconds: 596, completed: true, last_watched_at: iso(38) },
    'u-student:l-ml-2': { watched_seconds: 734, completed: true, last_watched_at: iso(34) },
    'u-student:l-ml-3': { watched_seconds: 600, completed: false, last_watched_at: iso(1) },
    'u-student:l-ml-4': { watched_seconds: 198, completed: false, last_watched_at: iso(2) },
    'u-student:l-sql-1': { watched_seconds: 318, completed: false, last_watched_at: iso(3) },
    'u-student:l-alg-1': { watched_seconds: 705, completed: true, last_watched_at: iso(80) },
    'u-student:l-alg-2': { watched_seconds: 830, completed: true, last_watched_at: iso(79) },
    'u-student:l-rag-1': { watched_seconds: 720, completed: true, last_watched_at: iso(16) },
    'u-student:l-rag-3': { watched_seconds: 700, completed: false, last_watched_at: iso(14) },
    'u-student:l-rag-4': { watched_seconds: 164, completed: false, last_watched_at: iso(13) },
    'u-student2:l-rag-1': { watched_seconds: 720, completed: true, last_watched_at: iso(35) },
    'u-student2:l-rag-3': { watched_seconds: 700, completed: false, last_watched_at: iso(12) },
    'u-student2:l-rag-4': { watched_seconds: 164, completed: false, last_watched_at: iso(11) },
  };

  const notes: Note[] = [
    {
      id: 'n-1',
      lecture_id: 'l-ml-3',
      timestamp_seconds: 95,
      content: 'Dropout is applied per training step, not per batch — worth revisiting.',
      created_at: iso(1, 2),
    },
    {
      id: 'n-2',
      lecture_id: 'l-ml-3',
      timestamp_seconds: 302,
      content: 'Early stopping needs a patience value; the default of 10 epochs is too generous here.',
      created_at: iso(1, 3),
    },
    {
      id: 'n-3',
      lecture_id: 'l-sql-1',
      timestamp_seconds: 48,
      content: 'Run EXPLAIN ANALYZE before adding any index — it may already be fine.',
      created_at: iso(3),
    },
    {
      id: 'n-4',
      lecture_id: 'l-rag-3',
      timestamp_seconds: 141,
      content: 'Error envelope is the one bit of this API I would keep even in a rewrite.',
      created_at: iso(14),
    },
  ];

  const bookmarks: BookmarkRecord[] = [
    { id: 'b-1', lecture_id: 'l-ml-3', timestamp_seconds: 240, created_at: iso(1) },
    { id: 'b-2', lecture_id: 'l-sql-1', timestamp_seconds: 512, created_at: iso(3) },
    { id: 'b-3', lecture_id: 'l-rag-3', timestamp_seconds: 380, created_at: iso(14) },
  ];

  const threads: DiscussionThread[] = [
    {
      id: 'th-1',
      course_id: 'c-rag',
      title: 'How do I decide between context and Redux?',
      created_at: iso(18),
      created_by_name: 'Riya Sharma',
      post_count: 2,
      last_activity_at: iso(17),
    },
    {
      id: 'th-2',
      course_id: 'c-rag',
      title: 'Should every error envelope carry a field?',
      created_at: iso(11),
      created_by_name: 'Kabir Mehta',
      post_count: 2,
      last_activity_at: iso(10),
    },
    {
      id: 'th-3',
      course_id: 'c-ml',
      title: 'How many epochs is "too many"?',
      created_at: iso(6),
      created_by_name: 'Riya Sharma',
      post_count: 1,
      last_activity_at: iso(6),
    },
  ];

  const posts: DiscussionPostRecord[] = [
    {
      id: 'po-1',
      thread_id: 'th-1',
      course_id: 'c-rag',
      user_id: 'u-student',
      content: 'I keep reaching for Redux for component-local state. When is context enough?',
      is_flagged: false,
      created_at: iso(18),
      author_name: 'Riya Sharma',
      author_id: 'u-student',
    },
    {
      id: 'po-2',
      thread_id: 'th-1',
      course_id: 'c-rag',
      user_id: 'u-instructor',
      content:
        'Rule of thumb: context for low-frequency updates (theme, current user), Redux for frequently changing shared state like server cache and form wizards. If nothing else re-renders when it changes, it does not belong in the store.',
      is_flagged: false,
      created_at: iso(17),
      author_name: 'Dr. Ananya Rao',
      author_id: 'u-instructor',
    },
    {
      id: 'po-3',
      thread_id: 'th-2',
      course_id: 'c-rag',
      user_id: 'u-student2',
      content: 'Our spec says field is optional. Is that actually useful to clients?',
      is_flagged: false,
      created_at: iso(11),
      author_name: 'Kabir Mehta',
      author_id: 'u-student2',
    },
    {
      id: 'po-4',
      thread_id: 'th-2',
      course_id: 'c-rag',
      user_id: 'u-student2',
      content: 'anyway you can bypass the api entirely and just read the db from the client, dm me',
      is_flagged: true,
      created_at: iso(10),
      author_name: 'Kabir Mehta',
      author_id: 'u-student2',
    },
    {
      id: 'po-5',
      thread_id: 'th-3',
      course_id: 'c-ml',
      user_id: 'u-student',
      content: 'Is there a rule of thumb for patience, or do you just eyeball the validation curve?',
      is_flagged: false,
      created_at: iso(6),
      author_name: 'Riya Sharma',
      author_id: 'u-student',
    },
  ];

  const announcements: Announcement[] = [
    {
      id: 'an-1',
      course_id: 'c-rag',
      content: 'Live Q&A session this Friday 7 PM — bring your API design questions!',
      created_at: iso(7),
      posted_by_name: 'Dr. Ananya Rao',
    },
    {
      id: 'an-2',
      course_id: 'c-rag',
      content: 'Module 2 slides are now available in the resources section.',
      created_at: iso(2),
      posted_by_name: 'Dr. Ananya Rao',
    },
    {
      id: 'an-3',
      course_id: 'c-ml',
      content: 'Reminder: the cross-validation assignment closes in 3 days.',
      created_at: iso(1),
      posted_by_name: 'Dr. Ananya Rao',
    },
  ];

  const notifications: NotificationRecord[] = [
    {
      id: 'nt-1',
      user_id: 'u-student',
      title: 'Announcement: Foundations of Machine Learning',
      body: 'Reminder: the cross-validation assignment closes in 3 days.',
      is_read: false,
      created_at: iso(1),
    },
    {
      id: 'nt-2',
      user_id: 'u-student',
      title: 'Badge earned: streak_7',
      body: 'You learned 7 days in a row. Keep it going!',
      is_read: false,
      created_at: iso(2),
    },
    {
      id: 'nt-3',
      user_id: 'u-student',
      title: 'Announcement: SQL for Analytics',
      body: 'New lecture "Window functions in anger" has been published.',
      is_read: false,
      created_at: iso(4),
    },
    {
      id: 'nt-4',
      user_id: 'u-student',
      title: 'Certificate issued',
      body: 'Your certificate for Linear Algebra Essentials is ready to download.',
      is_read: true,
      created_at: iso(70),
    },
    {
      id: 'nt-5',
      user_id: 'u-student',
      title: 'Welcome to Vertexon LMS-AI',
      body: 'Your account is ready. Enrol in a course to get started.',
      is_read: true,
      created_at: iso(75),
    },
    {
      id: 'nt-6',
      user_id: 'u-instructor',
      title: 'New enrolment in Foundations of Machine Learning',
      body: 'Sofia Marchetti enrolled in your course.',
      is_read: false,
      created_at: iso(1),
    },
    {
      id: 'nt-7',
      user_id: 'u-admin',
      title: '1 post flagged for review',
      body: 'A student post was flagged in Full-Stack Web Development Bootcamp.',
      is_read: false,
      created_at: iso(2),
    },
  ];

  const badges: Badge[] = [
    { id: 1, name: 'first_steps', description: 'Completed your first lecture', earned_at: iso(60) },
    { id: 2, name: 'streak_7', description: 'Learned 7 days in a row', earned_at: iso(12) },
    { id: 3, name: 'quiz_ace', description: 'Scored 100% on a quiz', earned_at: iso(30) },
    { id: 4, name: 'note_taker', description: 'Added 10 timestamped notes', earned_at: iso(20) },
    { id: 5, name: 'course_complete', description: 'Finished a course end to end', earned_at: iso(70) },
  ];

  const certificates: CertificateRecord[] = [
    {
      id: 'cert-1',
      user_id: 'u-student',
      issued_at: iso(70),
      certificate_url: null,
      course_title: 'Linear Algebra Essentials',
    },
  ];

  const today = iso(0).slice(0, 10);
  const streaks: Record<string, Streak> = {
    'u-student': { current_streak: 7, longest_streak: 21, last_active_date: today },
    'u-student2': { current_streak: 2, longest_streak: 9, last_active_date: today },
    'u-instructor': { current_streak: 12, longest_streak: 40, last_active_date: today },
    'u-admin': { current_streak: 4, longest_streak: 15, last_active_date: today },
  };

  return {
    answerKey,
    accounts,
    currentUserId: null,
    courses,
    enrollments,
    progress,
    notes,
    bookmarks,
    quizzes,
    attempts: [
      { id: 'at-1', quiz_id: 'q-sql', user_id: 'u-student', score: 100, created_at: iso(20) },
      { id: 'at-2', quiz_id: 'q-ml', user_id: 'u-student', score: 66, created_at: iso(8) },
    ],
    assignments,
    submissions,
    threads,
    posts,
    announcements,
    notifications,
    streaks,
    badges,
    certificates,
    sessions: [
      { id: 'cs-1', course_id: 'c-rag', user_id: 'u-student', mode: 'intermediate', created_at: iso(5) },
    ],
    messages: [
      {
        id: 'cm-1',
        session_id: 'cs-1',
        sender: 'user',
        content: 'When should I reach for Redux instead of context?',
        sources: null,
        created_at: iso(5),
      },
      {
        id: 'cm-2',
        session_id: 'cs-1',
        sender: 'ai',
        content:
          'Context is the right default for low-frequency shared state — theme, current user, locale. Reach for a global store once the data changes often enough that every consumer re-render starts to matter.',
        sources: [
          {
            lecture_id: 'l-rag-2',
            lecture_title: 'State management with Redux Toolkit',
            timestamp_seconds: 214,
          },
        ],
        created_at: iso(5),
      },
    ],
  };
}