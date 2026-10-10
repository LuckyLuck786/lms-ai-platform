import { describe, expect, it } from 'vitest';
import {
  buildCtaUrl,
  buildTransportOptions,
  escapeHtml,
  renderEmail,
  sendEmail,
} from '../src/services/email';

describe('transactional email rendering (PRD §9.3)', () => {
  it('escapes HTML so content cannot inject markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("it's fine")).toBe('it&#39;s fine');
  });

  it('builds a branded multipart message', () => {
    const { subject, text, html } = renderEmail({
      kind: 'certificate',
      subject: 'Your certificate is ready',
      body: 'Congratulations! You completed the course.',
      recipients: ['a@example.com'],
      cta: { label: 'View certificate', path: '/dashboard' },
    });

    expect(subject).toBe('Your certificate is ready');
    expect(text).toContain('Congratulations!');
    expect(text).toContain('/dashboard');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Vertexon LMS-AI');
    expect(html).toContain('View certificate');
  });

  it('splits blank-line separated bodies into paragraphs', () => {
    const { html } = renderEmail({
      kind: 'generic',
      subject: 's',
      body: 'First paragraph.\n\nSecond paragraph.',
      recipients: [],
    });
    expect(html.match(/<p style/g)?.length).toBe(2);
  });

  it('omits the call to action when none is given', () => {
    const { html, text } = renderEmail({
      kind: 'generic',
      subject: 's',
      body: 'b',
      recipients: [],
    });
    expect(html).not.toContain('<a href');
    expect(text).not.toContain('Open the');
  });

  it('resolves cta paths against the configured app url', () => {
    expect(buildCtaUrl({ label: 'Go', path: '/dashboard' })).toMatch(/\/dashboard$/);
    expect(buildCtaUrl({ label: 'Go', path: 'courses/1' })).toMatch(/\/courses\/1$/);
    expect(buildCtaUrl()).toBeUndefined();
  });

  it('sends nothing when there are no real recipients', async () => {
    await expect(
      sendEmail({ kind: 'generic', subject: 's', body: 'b', recipients: ['  ', ''] }),
    ).resolves.toEqual({ sent: 0 });
  });
});

describe('smtp transport options', () => {
  it('enables pooling and reads host/port from the url', () => {
    expect(buildTransportOptions('smtp://localhost:1025')).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
      pool: true,
      maxConnections: 3,
    });
  });

  it('decodes credentials and marks smtps as secure', () => {
    expect(buildTransportOptions('smtps://user:pa%40ss@smtp.example.com:465')).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user', pass: 'pa@ss' },
      pool: true,
      maxConnections: 3,
    });
  });

  it('falls back to the scheme default port', () => {
    expect(buildTransportOptions('smtp://mail.example.com').port).toBe(587);
    expect(buildTransportOptions('smtps://mail.example.com').port).toBe(465);
  });
});
