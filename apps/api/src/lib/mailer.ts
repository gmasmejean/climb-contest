import nodemailer from 'nodemailer'

import type { Env } from '../env'

export interface Mailer {
  send(to: string, subject: string, html: string): Promise<void>
}

/**
 * Implémentation SMTP configurable — pas de verrou fournisseur. En dev/test/
 * CI, `SMTP_HOST` pointe vers Mailpit (voir infra/docker/docker-compose.yml) :
 * aucun e-mail réel n'est jamais envoyé hors production.
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>
  private readonly from: string

  constructor(env: Env) {
    this.from = env.MAIL_FROM
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    })
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, html })
  }
}
