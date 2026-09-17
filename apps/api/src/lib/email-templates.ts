export function verificationEmail(
  displayName: string,
  verifyUrl: string,
): {
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

/**
 * Uniquement le lien — jamais le PIN dans cet e-mail (DECISIONS.md ADR-027) :
 * garde une vraie séparation entre les deux facteurs même quand l'accès est
 * envoyé par e-mail plutôt que transmis en main propre.
 */
export function judgeAccessEmail(
  displayName: string,
  competitionName: string,
  accessUrl: string,
): { subject: string; html: string } {
  return {
    subject: `Votre accès juge — ${competitionName}`,
    html: `
      <p>Bonjour ${displayName},</p>
      <p>Voici votre lien d'accès pour noter les passages sur vos voies, pour la compétition « ${competitionName} » :</p>
      <p><a href="${accessUrl}">${accessUrl}</a></p>
      <p>Si un code d'accès (PIN) vous a été communiqué, gardez-le : il vous sera demandé en plus de ce lien.</p>
    `,
  }
}
