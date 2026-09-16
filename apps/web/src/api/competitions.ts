import type {
  Category,
  ChangeStatusInput,
  Competition,
  Competitor,
  CreateCategoryInput,
  CreateCompetitionInput,
  CreateCompetitorInput,
  CreateRouteInput,
  CreateRoundInput,
  ImportReport,
  ReadinessResponse,
  Round,
  Route,
  UpdateCategoryInput,
  UpdateCompetitionInput,
  UpdateCompetitorInput,
  UpdateRouteInput,
  UpdateRoundInput,
} from '@climbcontest/contracts'

import { apiFetch } from './client'

export type RouteWithCategories = Route & { categoryIds: string[] }

const json = (body: unknown) => JSON.stringify(body)

export const competitionsApi = {
  list: () => apiFetch<Competition[]>('/competitions'),
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
