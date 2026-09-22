import type { Mailer } from '../lib/mailer'

export interface SentEmail {
  to: string
  subject: string
  html: string
}

export class FakeMailer implements Mailer {
  readonly sent: SentEmail[] = []
  private failNextCount = 0

  send(to: string, subject: string, html: string): Promise<void> {
    if (this.failNextCount > 0) {
      this.failNextCount -= 1
      return Promise.reject(new Error('SMTP indisponible (simulé).'))
    }
    this.sent.push({ to, subject, html })
    return Promise.resolve()
  }

  /** Simule un serveur SMTP indisponible pour les N prochains envois. */
  failNext(count = 1): void {
    this.failNextCount = count
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
