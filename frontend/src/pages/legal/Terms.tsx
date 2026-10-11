import { LegalList, LegalPage, LegalSection } from './LegalPage';

/** Terms of use for the Vertexon LMS-AI platform. */
export default function Terms() {
  return (
    <LegalPage
      title="Terms of use"
      intro="These terms govern use of the Vertexon LMS-AI platform: the course catalog, the learner workspace, the AI tutor, and the credentials issued through it. By creating an account or using the platform you accept them."
    >
      <LegalSection heading="1. Accounts">
        <p>
          You need an account to enrol in courses, submit assessments, and use the AI tutor. You
          agree to provide accurate registration details, keep your password confidential, and
          accept responsibility for activity carried out under your account.
        </p>
        <p>
          Accounts may be suspended if they are used to disrupt the service, to submit work that is
          not your own, or to attempt to access other learners&apos; records.
        </p>
      </LegalSection>

      <LegalSection heading="2. Courses and instructor content">
        <p>
          Courses are published by instructors and reviewed by platform administrators before they
          appear in the catalog. Instructors retain copyright in the material they upload and grant
          Vertexon a licence to store, transcribe and serve that material to enrolled learners, and
          to index it so the AI tutor can cite it.
        </p>
        <p>
          Course material is licensed to you for personal study. You may not redistribute lectures,
          slide decks, transcripts or assessments, or use them to train other systems.
        </p>
      </LegalSection>

      <LegalSection heading="3. Assessments and academic integrity">
        <LegalList
          items={[
            'Quizzes are auto-graded for multiple-choice and multi-select questions; written answers are reviewed by the instructor.',
            'Assignment submissions must be your own work unless the assignment states otherwise.',
            'You may not upload another person’s files, or use the AI tutor to produce work you then submit as your own.',
            'Instructors may reject submissions and record a grade of zero where these rules are broken.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. AI tutor">
        <p>
          The AI tutor answers from the material ingested for the course you are viewing and cites
          the lectures it used. Answers can still be incomplete or wrong, and they are study
          assistance rather than professional advice. Do not paste confidential or personal data
          into the chat: messages are stored with the session so you can return to them.
        </p>
      </LegalSection>

      <LegalSection heading="5. Certificates">
        <p>
          A certificate is issued when an enrolment reaches full completion. Each certificate
          carries a serial number and a QR code that resolves to a public verification page, which
          confirms the credential holder, the course and the issue date. Certificates are not
          academic degrees and do not carry credit towards any qualification.
        </p>
      </LegalSection>

      <LegalSection heading="6. Acceptable use">
        <LegalList
          items={[
            'Do not attempt to probe, overload, or bypass the platform’s authentication, rate limits or payment systems.',
            'Do not post abusive, infringing or misleading content in discussions or announcements.',
            'Do not scrape the catalog, transcripts or learner data.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="7. Availability and changes">
        <p>
          Core learning features are operated on a best-effort availability target; AI features
          depend on third-party model providers and may be slower or briefly unavailable. We may
          update these terms, and material changes will be announced in the platform before they
          take effect.
        </p>
      </LegalSection>

      <LegalSection heading="8. Contact">
        <p>
          Questions about these terms, grades, or account removal can be raised through the
          platform administrator (Meera Admin, admin@vertexon.demo in the demonstration dataset).
        </p>
      </LegalSection>
    </LegalPage>
  );
}
