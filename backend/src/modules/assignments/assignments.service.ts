import fs from 'fs';
import path from 'path';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound, badRequest, conflict } from '../../utils/errors';
import { AuthUser } from '../../middleware/auth';
import { CreateAssignmentInput } from './assignments.schemas';

/**
 * Assignments (FR-S6, FR-I3): creation, file submission before deadline,
 * instructor grading. Files land in ./uploads and are served at /uploads;
 * the storage helper swaps to S3/MinIO without changing this module.
 */

async function requireOwnedCourse(user: AuthUser, courseId: string) {
  const course = await queryOne<{ instructor_id: string }>('SELECT instructor_id FROM courses WHERE id = $1', [
    courseId,
  ]);
  if (!course) throw notFound('Course not found');
  if (course.instructor_id !== user.id && !user.roles.includes('admin')) {
    throw forbidden('You do not own this course');
  }
}

export async function createAssignment(user: AuthUser, input: CreateAssignmentInput) {
  await requireOwnedCourse(user, input.course_id);
  const assignment = await queryOne(
    `INSERT INTO assignments (course_id, title, instructions, rubric, due_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      input.course_id,
      input.title,
      input.instructions ?? null,
      input.rubric ? JSON.stringify(input.rubric) : null,
      input.due_date ?? null,
    ],
  );
  return assignment;
}

export async function listAssignments(courseId: string, user: AuthUser) {
  const rows = await query(
    `SELECT a.id, a.title, a.instructions, a.rubric, a.due_date,
            (SELECT count(*)::int FROM assignment_submissions s WHERE s.assignment_id = a.id) AS submission_count,
            s.id AS my_submission_id, s.submitted_at AS my_submitted_at, s.grade AS my_grade, s.feedback AS my_feedback
     FROM assignments a
     LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.user_id = $2
     WHERE a.course_id = $1
     ORDER BY a.due_date NULLS LAST, a.title`,
    [courseId, user.id],
  );
  return rows;
}

export async function submitAssignment(
  user: AuthUser,
  assignmentId: string,
  file: { originalname: string; filename: string; path: string; size: number },
) {
  const assignment = await queryOne<{ id: string; course_id: string; due_date: Date | null }>(
    'SELECT id, course_id, due_date FROM assignments WHERE id = $1',
    [assignmentId],
  );
  if (!assignment) throw notFound('Assignment not found');

  const enrolled = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
    user.id,
    assignment.course_id,
  ]);
  if (!enrolled) throw forbidden('You are not enrolled in this course');

  if (assignment.due_date && new Date(assignment.due_date) < new Date()) {
    fs.unlink(file.path, () => undefined); // don't keep late uploads
    throw forbidden('The deadline for this assignment has passed');
  }

  const existing = await queryOne('SELECT id FROM assignment_submissions WHERE assignment_id = $1 AND user_id = $2', [
    assignmentId,
    user.id,
  ]);
  if (existing) {
    fs.unlink(file.path, () => undefined);
    throw conflict('You have already submitted this assignment');
  }

  const fileUrl = `/uploads/${path.basename(path.dirname(file.path))}/${file.filename}`;
  const submission = await queryOne(
    `INSERT INTO assignment_submissions (assignment_id, user_id, file_url)
     VALUES ($1, $2, $3) RETURNING *`,
    [assignmentId, user.id, fileUrl],
  );
  return submission;
}

export async function gradeSubmission(user: AuthUser, submissionId: string, grade: number, feedback?: string) {
  const submission = await queryOne<{ id: string }>(
    `SELECT s.id FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN courses c ON c.id = a.course_id
     WHERE s.id = $1 AND (c.instructor_id = $2 OR $3)`,
    [submissionId, user.id, user.roles.includes('admin')],
  );
  if (!submission) throw notFound('Submission not found or not yours to grade');

  return queryOne(
    `UPDATE assignment_submissions SET grade = $2, feedback = $3 WHERE id = $1 RETURNING *`,
    [submissionId, grade, feedback ?? null],
  );
}

export async function listSubmissions(user: AuthUser, assignmentId: string) {
  const assignment = await queryOne<{ id: string }>(
    `SELECT a.id FROM assignments a
     JOIN courses c ON c.id = a.course_id
     WHERE a.id = $1 AND (c.instructor_id = $2 OR $3)`,
    [assignmentId, user.id, user.roles.includes('admin')],
  );
  if (!assignment) throw notFound('Assignment not found or not yours');

  return query(
    `SELECT s.id, s.user_id, s.file_url, s.submitted_at, s.grade, s.feedback, u.full_name
     FROM assignment_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.assignment_id = $1 ORDER BY s.submitted_at DESC`,
    [assignmentId],
  );
}

export function assertValidFile(file: Express.Multer.File | undefined): void {
  if (!file) throw badRequest('A file is required (field name: file)', 'file');
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) throw badRequest('File exceeds the 25 MB limit', 'file');
}
