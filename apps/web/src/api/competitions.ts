import type {
  Category,
  ChangeCompetitorStatusInput,
  ChangeRoundStatusInput,
  ChangeStatusInput,
  Competition,
  Competitor,
  CreateCategoryInput,
  CreateCompetitionInput,
  CreateCompetitorInput,
  CreateRouteInput,
  CreateRoundInput,
  ImportReport,
  BackupPreview,
  ImportBackupResult,
  PurgePersonalDataResult,
  ReadinessResponse,
  Round,
  RoundQualifiersResponse,
  Route,
  UpdateCategoryInput,
  UpdateCompetitionInput,
  UpdateCompetitorInput,
  UpdateRouteInput,
  UpdateRoundInput,
} from '@climbcontest/contracts'

import { apiDownload, apiFetch, saveBlob } from './client'

export type RouteWithCategories = Route & { categoryIds: string[] }

const json = (body: unknown) => JSON.stringify(body)

export const competitionsApi = {
  list: () => apiFetch<Competition[]>('/competitions'),
  listTrash: () => apiFetch<Competition[]>('/competitions/trash'),
  trash: (id: string) => apiFetch<Competition>(`/competitions/${id}`, { method: 'DELETE' }),
  restore: (id: string) => apiFetch<Competition>(`/competitions/${id}/restore`, { method: 'POST' }),
  deletePermanently: (id: string) =>
    apiFetch<undefined>(`/competitions/${id}/permanent`, { method: 'DELETE' }),
  get: (id: string) => apiFetch<Competition>(`/competitions/${id}`),
  create: (input: CreateCompetitionInput) =>
    apiFetch<Competition>('/competitions', { method: 'POST', body: json(input) }),
  update: (id: string, input: UpdateCompetitionInput) =>
    apiFetch<Competition>(`/competitions/${id}`, { method: 'PATCH', body: json(input) }),
  changeStatus: (id: string, input: ChangeStatusInput) =>
    apiFetch<Competition>(`/competitions/${id}/status`, { method: 'POST', body: json(input) }),
  readiness: (id: string) => apiFetch<ReadinessResponse>(`/competitions/${id}/readiness`),
}

export const categoriesApi = {
  list: (competitionId: string) =>
    apiFetch<Category[]>(`/competitions/${competitionId}/categories`),
  create: (competitionId: string, input: CreateCategoryInput) =>
    apiFetch<Category>(`/competitions/${competitionId}/categories`, {
      method: 'POST',
      body: json(input),
    }),
  applyTemplate: (competitionId: string) =>
    apiFetch<Category[]>(`/competitions/${competitionId}/categories/template`, { method: 'POST' }),
  update: (competitionId: string, categoryId: string, input: UpdateCategoryInput) =>
    apiFetch<Category>(`/competitions/${competitionId}/categories/${categoryId}`, {
      method: 'PATCH',
      body: json(input),
    }),
  remove: (competitionId: string, categoryId: string) =>
    apiFetch<undefined>(`/competitions/${competitionId}/categories/${categoryId}`, {
      method: 'DELETE',
    }),
  reorder: (competitionId: string, orderedIds: string[]) =>
    apiFetch<Category[]>(`/competitions/${competitionId}/categories/reorder`, {
      method: 'POST',
      body: json({ orderedIds }),
    }),
}

export const competitorsApi = {
  list: (competitionId: string) =>
    apiFetch<Competitor[]>(`/competitions/${competitionId}/competitors`),
  create: (competitionId: string, input: CreateCompetitorInput) =>
    apiFetch<Competitor>(`/competitions/${competitionId}/competitors`, {
      method: 'POST',
      body: json(input),
    }),
  update: (competitionId: string, competitorId: string, input: UpdateCompetitorInput) =>
    apiFetch<Competitor>(`/competitions/${competitionId}/competitors/${competitorId}`, {
      method: 'PATCH',
      body: json(input),
    }),
  remove: (competitionId: string, competitorId: string) =>
    apiFetch<undefined>(`/competitions/${competitionId}/competitors/${competitorId}`, {
      method: 'DELETE',
    }),
  changeStatus: (competitionId: string, competitorId: string, input: ChangeCompetitorStatusInput) =>
    apiFetch<Competitor>(`/competitions/${competitionId}/competitors/${competitorId}/status`, {
      method: 'PATCH',
      body: json(input),
    }),
  /** 422 (aperçu invalide) est un rapport exploitable, pas une erreur générique. */
  importPreview: (competitionId: string, csv: string) =>
    apiFetch<ImportReport>(
      `/competitions/${competitionId}/competitors/import`,
      { method: 'POST', body: json({ csv, mode: 'preview' }) },
      true,
      [422],
    ),
  importCommit: (competitionId: string, csv: string) =>
    apiFetch<ImportReport>(
      `/competitions/${competitionId}/competitors/import`,
      { method: 'POST', body: json({ csv, mode: 'commit' }) },
      true,
      [422],
    ),
  assignBibs: (competitionId: string) =>
    apiFetch<Competitor[]>(`/competitions/${competitionId}/competitors/assign-bibs`, {
      method: 'POST',
    }),
}

export const routesApi = {
  list: (competitionId: string) =>
    apiFetch<RouteWithCategories[]>(`/competitions/${competitionId}/routes`),
  create: (competitionId: string, input: CreateRouteInput) =>
    apiFetch<RouteWithCategories>(`/competitions/${competitionId}/routes`, {
      method: 'POST',
      body: json(input),
    }),
  update: (competitionId: string, routeId: string, input: UpdateRouteInput) =>
    apiFetch<RouteWithCategories>(`/competitions/${competitionId}/routes/${routeId}`, {
      method: 'PATCH',
      body: json(input),
    }),
  reorder: (competitionId: string, orderedIds: string[]) =>
    apiFetch<RouteWithCategories[]>(`/competitions/${competitionId}/routes/reorder`, {
      method: 'POST',
      body: json({ orderedIds }),
    }),
}

export const roundsApi = {
  list: (competitionId: string) => apiFetch<Round[]>(`/competitions/${competitionId}/rounds`),
  create: (competitionId: string, input: CreateRoundInput) =>
    apiFetch<Round>(`/competitions/${competitionId}/rounds`, { method: 'POST', body: json(input) }),
  update: (competitionId: string, roundId: string, input: UpdateRoundInput) =>
    apiFetch<Round>(`/competitions/${competitionId}/rounds/${roundId}`, {
      method: 'PATCH',
      body: json(input),
    }),
  changeStatus: (competitionId: string, roundId: string, input: ChangeRoundStatusInput) =>
    apiFetch<Round>(`/competitions/${competitionId}/round-status/${roundId}`, {
      method: 'POST',
      body: json(input),
    }),
  // ADR-054 : la liste des qualifiés figée à l'ouverture du tour.
  qualifiers: (competitionId: string, roundId: string) =>
    apiFetch<RoundQualifiersResponse>(
      `/competitions/${competitionId}/round-status/${roundId}/qualifiers`,
    ),
  reorder: (competitionId: string, orderedIds: string[]) =>
    apiFetch<Round[]>(`/competitions/${competitionId}/rounds/reorder`, {
      method: 'POST',
      body: json({ orderedIds }),
    }),
  getRoutes: (competitionId: string, roundId: string) =>
    apiFetch<{ routeId: string; categoryId: string }[]>(
      `/competitions/${competitionId}/rounds/${roundId}/routes`,
    ),
  setRoutes: (
    competitionId: string,
    roundId: string,
    assignments: { routeId: string; categoryId: string }[],
  ) =>
    apiFetch<{ routeId: string; categoryId: string }[]>(
      `/competitions/${competitionId}/rounds/${roundId}/routes`,
      { method: 'PUT', body: json({ assignments }) },
    ),
}

/** Lot 9 — exports de résultats et sauvegarde JSON, réimport (ADR-056). */
export const exportsApi = {
  download: async (
    competitionId: string,
    file: 'results.pdf' | 'results.csv' | 'competition.json',
    categoryId?: string,
  ) => {
    const query = categoryId && file !== 'competition.json' ? `?category=${categoryId}` : ''
    const { blob, filename } = await apiDownload(
      `/competitions/${competitionId}/exports/${file}${query}`,
      file,
    )
    saveBlob(blob, filename)
  },
  downloadPersonalData: async (competitionId: string) => {
    const { blob, filename } = await apiDownload(
      `/competitions/${competitionId}/gdpr-export`,
      'donnees-personnelles.json',
    )
    saveBlob(blob, filename)
  },
  purgePersonalData: (competitionId: string, confirmName: string) =>
    apiFetch<PurgePersonalDataResult>(`/competitions/${competitionId}/personal-data`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmName }),
    }),
  previewImport: (backup: unknown) =>
    apiFetch<BackupPreview>('/competitions/import', {
      method: 'POST',
      body: JSON.stringify({ mode: 'preview', backup }),
    }),
  commitImport: (backup: unknown) =>
    apiFetch<ImportBackupResult>('/competitions/import', {
      method: 'POST',
      body: JSON.stringify({ mode: 'commit', backup }),
    }),
}
