/** Projects with milestones, and the (at most 3) weekly goals — together projects.json. */
import {
  MAX_WEEKLY_GOALS,
  type DateKey,
  type FocusSession,
  type Milestone,
  type Project,
  type ProjectsFile,
  type ProjectStatus,
  type WeeklyGoal,
} from './model';

export const PROJECT_NAME_MAX_LENGTH = 40;
export const MILESTONE_MAX_LENGTH = 80;
export const GOAL_MAX_LENGTH = 80;

/** Calm colors that read well on light and dark backgrounds. */
export const PROJECT_COLORS = ['#4f7a64', '#5b7fa6', '#8a6fb0', '#b0677f', '#c07a4a', '#b59a3c', '#4f9a9a', '#7a7f86'] as const;
export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0];

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'done'];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const clean = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** A safe color for markup: any #rrggbb, else the default. */
export function normalizeColor(color: unknown): string {
  return typeof color === 'string' && HEX_COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_PROJECT_COLOR;
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === 'active' || value === 'paused' || value === 'done';
}

// ---------- Projects ----------

export interface NewProject {
  name: string;
  color?: string;
}

export function createProject(input: NewProject, id: string, now: string): Project {
  return {
    id,
    name: clean(input.name, PROJECT_NAME_MAX_LENGTH) || 'New project',
    color: normalizeColor(input.color ?? DEFAULT_PROJECT_COLOR),
    status: 'active',
    milestones: [],
    createdAt: now,
    updatedAt: now,
  };
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'color' | 'status'>>;

export function updateProject(project: Project, patch: ProjectPatch, now: string): Project {
  const next: Project = { ...project, updatedAt: now };
  if (patch.name !== undefined) next.name = clean(patch.name, PROJECT_NAME_MAX_LENGTH) || project.name;
  if (patch.color !== undefined) next.color = normalizeColor(patch.color);
  if (patch.status !== undefined && isProjectStatus(patch.status)) next.status = patch.status;
  return next;
}

export function addMilestone(project: Project, title: string, id: string, now: string): Project {
  const text = clean(title, MILESTONE_MAX_LENGTH);
  if (!text) return project;
  return { ...project, milestones: [...project.milestones, { id, title: text, done: false }], updatedAt: now };
}

function changeMilestone(project: Project, id: string, change: (m: Milestone) => Milestone | null, now: string): Project {
  if (!project.milestones.some((m) => m.id === id)) return project;
  const milestones = project.milestones.flatMap((m) => {
    if (m.id !== id) return [m];
    const next = change(m);
    return next ? [next] : [];
  });
  return { ...project, milestones, updatedAt: now };
}

export function toggleMilestone(project: Project, id: string, now: string): Project {
  return changeMilestone(project, id, (m) => ({ ...m, done: !m.done }), now);
}

export function renameMilestone(project: Project, id: string, title: string, now: string): Project {
  const text = clean(title, MILESTONE_MAX_LENGTH);
  if (!text) return project;
  return changeMilestone(project, id, (m) => ({ ...m, title: text }), now);
}

export function removeMilestone(project: Project, id: string, now: string): Project {
  return changeMilestone(project, id, () => null, now);
}

export function milestoneProgress(project: Pick<Project, 'milestones'>): { done: number; total: number } {
  return { done: project.milestones.filter((m) => m.done).length, total: project.milestones.length };
}

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, paused: 1, done: 2 };

/** Active first, then paused, then done; newest first within each. */
export function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Total focus minutes per project id, from sessions tagged with a project. */
export function focusMinutesByProject(sessions: Iterable<FocusSession>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    if (!s.projectId || !Number.isFinite(s.minutes) || s.minutes <= 0) continue;
    totals.set(s.projectId, (totals.get(s.projectId) ?? 0) + s.minutes);
  }
  return totals;
}

// ---------- Weekly goals ----------

export function goalsForWeek(file: Pick<ProjectsFile, 'weeklyGoals'>, weekStart: DateKey): WeeklyGoal[] {
  return file.weeklyGoals.filter((g) => g.weekStart === weekStart);
}

export function canAddGoal(file: Pick<ProjectsFile, 'weeklyGoals'>, weekStart: DateKey): boolean {
  return goalsForWeek(file, weekStart).length < MAX_WEEKLY_GOALS;
}

/** Adds a goal to the week, unless the text is empty or the week already has 3. */
export function addWeeklyGoal(file: ProjectsFile, text: string, id: string, weekStart: DateKey, now: string): ProjectsFile {
  const goal = clean(text, GOAL_MAX_LENGTH);
  if (!goal || !canAddGoal(file, weekStart)) return file;
  return {
    ...file,
    weeklyGoals: [...file.weeklyGoals, { id, weekStart, text: goal, done: false, updatedAt: now }],
    updatedAt: now,
  };
}

function changeGoal(file: ProjectsFile, id: string, change: (g: WeeklyGoal) => WeeklyGoal | null, now: string): ProjectsFile {
  if (!file.weeklyGoals.some((g) => g.id === id)) return file;
  const weeklyGoals = file.weeklyGoals.flatMap((g) => {
    if (g.id !== id) return [g];
    const next = change(g);
    return next ? [{ ...next, updatedAt: now }] : [];
  });
  return { ...file, weeklyGoals, updatedAt: now };
}

export function toggleWeeklyGoal(file: ProjectsFile, id: string, now: string): ProjectsFile {
  return changeGoal(file, id, (g) => ({ ...g, done: !g.done }), now);
}

export function removeWeeklyGoal(file: ProjectsFile, id: string, now: string): ProjectsFile {
  return changeGoal(file, id, () => null, now);
}

// ---------- File-level edits ----------

export function upsertProject(file: ProjectsFile, project: Project, now: string): ProjectsFile {
  const exists = file.projects.some((p) => p.id === project.id);
  const projects = exists ? file.projects.map((p) => (p.id === project.id ? project : p)) : [...file.projects, project];
  return { ...file, projects, updatedAt: now };
}

export function changeProject(file: ProjectsFile, id: string, change: (p: Project) => Project, now: string): ProjectsFile {
  if (!file.projects.some((p) => p.id === id)) return file;
  return { ...file, projects: file.projects.map((p) => (p.id === id ? change(p) : p)), updatedAt: now };
}

export function removeProject(file: ProjectsFile, id: string, now: string): ProjectsFile {
  return { ...file, projects: file.projects.filter((p) => p.id !== id), updatedAt: now };
}

/** Fills in fields missing from data written by older versions, and makes colors safe. */
export function normalizeProjectsFile(raw: Partial<ProjectsFile> | undefined, now: string): ProjectsFile {
  const projects = (raw?.projects ?? []).map((p) => ({
    ...p,
    name: typeof p.name === 'string' && p.name ? p.name : 'Project',
    color: normalizeColor(p.color),
    status: isProjectStatus(p.status) ? p.status : 'active',
    milestones: Array.isArray(p.milestones) ? p.milestones : [],
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? p.createdAt ?? now,
  }));
  const weeklyGoals = (raw?.weeklyGoals ?? []).map((g) => ({ ...g, updatedAt: g.updatedAt ?? now }));
  return { projects, weeklyGoals, updatedAt: raw?.updatedAt ?? now };
}
