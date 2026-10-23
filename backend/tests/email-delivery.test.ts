import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Delivery rules: never show one learner another learner's address, and never
 * send to addresses that cannot exist (they only bounce into the sender's inbox).
 */

const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
process.env.SMTP_URL = 'smtps://user:pass@smtp.example.org:465';

const { isDeliverable, sendEmail } = await import('../src/services/email');

beforeEach(() => sendMail.mockClear());

describe('isDeliverable', () => {
  it('drops reserved and demo domains', () => {
    for (const a of ['a@example.com', 'b@mail.example.org', 'c@site.test', 'd@x.invalid', 'admin@vertexon.demo']) {
      expect(isDeliverable(a), a).toBe(false);
    }
  });
  it('keeps real addresses', () => {
    for (const a of ['ananya@gmail.com', 'rohit@college.ac.in', 'x@examples.com']) {
      expect(isDeliverable(a), a).toBe(true);
    }
  });
});

describe('sendEmail', () => {
  it('addresses a single recipient directly', async () => {
    await sendEmail({ kind: 'account', subject: 's', body: 'b', recipients: ['ananya@gmail.com'] });
    expect(sendMail.mock.calls[0][0].to).toBe('ananya@gmail.com');
    expect(sendMail.mock.calls[0][0].bcc).toBeUndefined();
  });

  it('puts several recipients in Bcc so none sees the others', async () => {
    const recipients = ['a@gmail.com', 'b@gmail.com', 'c@gmail.com'];
    await expect(sendEmail({ kind: 'announcement', subject: 's', body: 'b', recipients })).resolves.toEqual({
      sent: 3,
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.bcc).toEqual(recipients);
    expect(String(mail.to)).not.toContain('a@gmail.com');
  });

  it('batches large announcements', async () => {
    const recipients = Array.from({ length: 120 }, (_, i) => `l${i}@gmail.com`);
    await sendEmail({ kind: 'announcement', subject: 's', body: 'b', recipients });
    expect(sendMail.mock.calls.map((c) => c[0].bcc.length)).toEqual([50, 50, 20]);
  });

  it('skips undeliverable recipients entirely', async () => {
    await expect(
      sendEmail({ kind: 'account', subject: 's', body: 'b', recipients: ['x@example.com'] }),
    ).resolves.toEqual({ sent: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
