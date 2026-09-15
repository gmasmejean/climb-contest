export function verificationEmail(displayName: string, verifyUrl: string): {
  subject: string
  html: string
} {
  return {
    subject: 'Confirmez votre e-mail — ClimbContest',
    html: `
      <p>Bonjour ${displayName},</p>
      <p>Merci de votre inscription sur ClimbContest. Confirmez votre adresse e-mail en cliquant sur le lien ci-dessous :</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Ce lien est valable 24 heures.</p>
    `,
  }
}

export function invitationEmail(
  displayName: string,
  clubName: string,
  inviterName: string,
  acceptUrl: string,
): { subject: string; html: string } {
  return {
    subject: `${inviterName} vous invite à rejoindre ${clubName} sur ClimbContest`,
    html: `
      <p>Bonjour ${displayName},</p>
      <p>${inviterName} vous invite à devenir organisateur du club « ${clubName} » sur ClimbContest.</p>
      <p>Définissez votre mot de passe en cliquant sur le lien ci-dessous :</p>
      <p><a href="${acceptUrl}">${acceptUrl}</a></p>
      <p>Ce lien est valable 7 jours.</p>
    `,
  }
}
