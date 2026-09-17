/**
 * Seed de développement — une compétition d'exemple réaliste (Lot 1, point 3
 * de ROADMAP.md). Les jetons de juge générés ici sont des données de
 * démonstration, pas l'implémentation réelle du flux d'accès juge (Lot 4).
 */
import { randomInt } from 'node:crypto'

import { fakerFR as faker } from '@faker-js/faker'
import { eq } from 'drizzle-orm'

import { createDatabase } from './client'
import { hashPassword, hashToken, randomPin, randomToken } from './crypto'
import {
  category,
  club,
  competition,
  competitor,
  judge,
  judgeRoute,
  round,
  roundRoute,
  route,
  routeCategory,
  user,
} from './schema'

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquante — voir .env.example.')
  }
  const { db, close } = createDatabase(databaseUrl)

  try {
    const existing = await db.query.club.findFirst({ where: eq(club.slug, 'club-demo') })
    if (existing) {
      console.log('Le club de démonstration existe déjà — seed ignoré.')
      return
    }

    const [demoClub] = await db
      .insert(club)
      .values({ name: 'Club Démo Escalade', slug: 'club-demo' })
      .returning()
    if (!demoClub) throw new Error('Échec de la création du club de démonstration.')

    const ownerPassword = 'ChangeMoi123!'
    const [owner] = await db
      .insert(user)
      .values({
        clubId: demoClub.id,
        email: 'organisateur@club-demo.test',
        passwordHash: await hashPassword(ownerPassword),
        displayName: 'Alex Organisateur',
        role: 'owner',
        emailVerifiedAt: new Date(),
      })
      .returning()
    if (!owner) throw new Error("Échec de la création de l'owner de démonstration.")

    const [demoCompetition] = await db
      .insert(competition)
      .values({
        clubId: demoClub.id,
        name: 'Open du Club Démo 2026',
        venue: 'Salle Démo',
        startsOn: '2026-11-14',
        endsOn: '2026-11-14',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        scoringConfig: { routesCounted: 3 },
        publicSlug: randomToken(16),
        judgePinRequired: true,
        createdBy: owner.id,
      })
      .returning()
    if (!demoCompetition)
      throw new Error('Échec de la création de la compétition de démonstration.')

    const categoriesData = [
      { label: 'U16 Homme', sex: 'M' as const, order: 0 },
      { label: 'U16 Femme', sex: 'F' as const, order: 1 },
    ]
    const categories = []
    for (const data of categoriesData) {
      const [created] = await db
        .insert(category)
        .values({
          competitionId: demoCompetition.id,
          label: data.label,
          sex: data.sex,
          displayOrder: data.order,
        })
        .returning()
      if (!created) throw new Error(`Échec de la création de la catégorie ${data.label}.`)
      categories.push(created)
    }

    const routesData = [
      { number: 1, holdCount: 38, sector: 'Dévers', color: 'Rouge' },
      { number: 2, holdCount: 42, sector: 'Dalle', color: 'Bleu' },
      { number: 3, holdCount: 35, sector: 'Vertical', color: 'Jaune' },
      { number: 4, holdCount: 40, sector: 'Dévers', color: 'Vert' },
    ]
    const routes = []
    for (const data of routesData) {
      const [created] = await db
        .insert(route)
        .values({
          competitionId: demoCompetition.id,
          number: data.number,
          holdCount: data.holdCount,
          sector: data.sector,
          color: data.color,
        })
        .returning()
      if (!created) throw new Error(`Échec de la création de la voie ${data.number}.`)
      routes.push(created)
      for (const cat of categories) {
        await db.insert(routeCategory).values({ routeId: created.id, categoryId: cat.id })
      }
    }

    const [qualification] = await db
      .insert(round)
      .values({
        competitionId: demoCompetition.id,
        type: 'qualification',
        style: 'onsight',
        displayOrder: 0,
        status: 'open',
      })
      .returning()
    if (!qualification) throw new Error('Échec de la création du tour de démonstration.')

    for (const r of routes) {
      for (const cat of categories) {
        await db
          .insert(roundRoute)
          .values({ roundId: qualification.id, routeId: r.id, categoryId: cat.id })
      }
    }

    let bib = 1
    for (const cat of categories) {
      for (let i = 0; i < 6; i += 1) {
        await db.insert(competitor).values({
          competitionId: demoCompetition.id,
          categoryId: cat.id,
          bib: bib++,
          firstName: faker.person.firstName(cat.sex === 'F' ? 'female' : 'male'),
          lastName: faker.person.lastName(),
          birthYear: 2010 + randomInt(0, 4),
          clubName: faker.company.name(),
        })
      }
    }

    const judgesData = [
      { name: 'Juge Voies 1-2', routes: [routes[0], routes[1]] },
      { name: 'Juge Voies 3-4', routes: [routes[2], routes[3]] },
    ]
    for (const data of judgesData) {
      const accessToken = randomToken(32)
      const pin = randomPin()
      const [createdJudge] = await db
        .insert(judge)
        .values({
          competitionId: demoCompetition.id,
          displayName: data.name,
          accessTokenHash: hashToken(accessToken),
          accessTokenPrefix: accessToken.slice(0, 8),
          pinHash: await hashPassword(pin),
        })
        .returning()
      if (!createdJudge) throw new Error(`Échec de la création du juge ${data.name}.`)
      for (const r of data.routes) {
        if (!r) continue
        await db.insert(judgeRoute).values({ judgeId: createdJudge.id, routeId: r.id })
      }
      console.log(`Juge « ${data.name} » — lien de démo : /j/${accessToken} — PIN : ${pin}`)
    }

    console.log('')
    console.log('Seed terminé.')
    console.log(`Connexion organisateur : ${owner.email} / ${ownerPassword}`)
    console.log(`Compétition publique : /c/${demoCompetition.publicSlug}`)
  } finally {
    await close()
  }
}

await main()
