import type { Mailer } from '../lib/mailer'

export interface SentEmail {
  to: string
  subject: string
  html: string
}

export class FakeMailer implements Mailer {
  readonly sent: SentEmail[] = []

  send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html })
    return Promise.resolve()
  }

  lastTokenFor(to: string): string {
    const email = [...this.sent].reverse().find((candidate) => candidate.to === to)
    if (!email) {
      throw new Error(`Aucun e-mail envoyé à ${to}.`)
    }
    const match = /token=([^"&\s<]+)/.exec(email.html)
    if (!match?.[1]) {
      throw new Error('Aucun jeton trouvé dans l’e-mail.')
    }
    return match[1]
  }
}
