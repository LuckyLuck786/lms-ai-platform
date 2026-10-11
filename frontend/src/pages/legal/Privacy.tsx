import { LegalList, LegalPage, LegalSection } from './LegalPage';

/** Privacy policy for the Vertexon LMS-AI platform. */
export default function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="This policy explains what the platform stores about you, why it is stored, how long it is kept, and how to get it removed. It applies to the course catalog, learner workspace, discussion forum and AI tutor."
    >
      <LegalSection heading="1. What we store">
        <LegalList
          items={[
            'Account details: your name, email address, role, and a bcrypt hash of your password (never the password itself).',
            'Learning records: enrolments, lecture progress and watch positions, notes, bookmarks, quiz attempts and scores, assignment files and grades.',
            'AI tutor sessions: the questions you ask and the answers returned, with the lecture citations used.',
            'Operational records: notifications sent to you, and an audit log of administrative actions (approvals, role changes, suspensions).',
          ]}
        />
      </LegalSection>

      <LegalSection heading="2. Why we store it">
        <p>
          Learning records drive your progress, certificates and the instructor analytics that tell
          teaching staff where learners struggle. Session history powers the AI tutor&apos;s
          continuity and the topic-mastery model that adjusts explanation depth. Audit records exist
          so that administrative actions can be reviewed.
        </p>
      </LegalSection>

      <LegalSection heading="3. Who can see it">
        <LegalList
          items={[
            'You can see your own progress, notes, submissions, badges and certificates.',
            'Course instructors see progress, quiz scores, drop-off and submissions for their own courses.',
            'Administrators see platform-level metrics, the approval queue and moderation reports; they do not read your private notes.',
            'Uploaded material is served only to authenticated requests, through the platform’s own file endpoints.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. AI processing">
        <p>
          When you ask the tutor a question, the question and the retrieved course excerpts are sent
          to our model provider to generate the answer. Prompts are not used to train third-party
          models under our provider agreements. Do not enter personal data about yourself or anyone
          else into the chat.
        </p>
      </LegalSection>

      <LegalSection heading="5. Where it lives and how it is protected">
        <p>
          Data is stored in a managed PostgreSQL database with encryption at rest, and uploaded
          files in object storage. Sessions are authenticated with short-lived access tokens and
          refresh tokens; passwords are hashed with bcrypt; administrative endpoints are restricted
          by role and every request is rate limited.
        </p>
      </LegalSection>

      <LegalSection heading="6. Retention and your rights">
        <p>
          Learning records are kept while your account is active so certificates remain verifiable.
          You may ask for an export of your data, correction of inaccurate details, or deletion of
          your account and its records; deletion removes your submissions, notes and sessions, and
          revokes issued credentials from the public verification register.
        </p>
      </LegalSection>

      <LegalSection heading="7. Cookies and local storage">
        <p>
          The platform stores your session tokens, your language choice and your light/dark
          preference in your browser so you stay signed in and the interface stays consistent. No
          advertising or third-party tracking cookies are used.
        </p>
      </LegalSection>

      <LegalSection heading="8. Contact">
        <p>
          Privacy requests can be raised through the platform administrator (Meera Admin,
          admin@vertexon.demo in the demonstration dataset).
        </p>
      </LegalSection>
    </LegalPage>
  );
}
