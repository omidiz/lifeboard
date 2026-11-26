import { describe, expect, it } from 'vitest';
import type { FocusSession, ProjectsFile } from './model';
import {
  addMilestone,
  addWeeklyGoal,
  canAddGoal,
  changeProject,
  createProject,
  focusMinutesByProject,
  goalsForWeek,
  milestoneProgress,
  normalizeColor,
  normalizeProjectsFile,
  removeMilestone,
  removeProject,
  removeWeeklyGoal,
  renameMilestone,
  sortProjects,
  toggleMilestone,
  toggleWeeklyGoal,
  updateProject,
  upsertProject,
} from './projects';

const NOW = '2026-11-26T08:00:00.000Z';
const LATER = '2026-11-26T09:00:00.000Z';
const WEEK = '2026-11-23';

const emptyFile = (): ProjectsFile => ({ projects: [], weeklyGoals: [], updatedAt: NOW });

describe('projects', () => {
  it('creates a clean active project', () => {
    const p = createProject({ name: '  Thesis   draft ', color: '#5B7FA6' }, 'p1', NOW);
    expect(p).toMatchObject({ id: 'p1', name: 'Thesis draft', color: '#5b7fa6', status: 'active', milestones: [] });
    expect(createProject({ name: '   ' }, 'p2', NOW).name).toBe('New project');
  });

  it('only accepts #rrggbb colors', () => {
    expect(normalizeColor('#abcdef')).toBe('#abcdef');
    expect(normalizeColor('red;background:url(x)')).toBe('#4f7a64');
    expect(normalizeColor(undefined)).toBe('#4f7a64');
  });

  it('updates name, color and status, ignoring bad values', () => {
    const p = createProject({ name: 'A' }, 'p1', NOW);
    const q = updateProject(p, { name: ' ', status: 'paused', color: 'nope' }, LATER);
    expect(q).toMatchObject({ name: 'A', status: 'paused', color: '#4f7a64', updatedAt: LATER });
    expect(updateProject(p, { status: 'archived' as never }, LATER).status).toBe('active');
  });

  it('adds, checks, renames and removes milestones', () => {
    let p = createProject({ name: 'A' }, 'p1', NOW);
    p = addMilestone(p, 'Outline', 'm1', NOW);
    p = addMilestone(p, 'First draft', 'm2', NOW);
    p = addMilestone(p, '   ', 'm3', NOW);
    expect(milestoneProgress(p)).toEqual({ done: 0, total: 2 });
    p = toggleMilestone(p, 'm1', LATER);
    expect(milestoneProgress(p)).toEqual({ done: 1, total: 2 });
    p = renameMilestone(p, 'm2', 'Full draft', LATER);
    expect(p.milestones[1].title).toBe('Full draft');
    expect(renameMilestone(p, 'm2', '  ', LATER).milestones[1].title).toBe('Full draft');
    p = removeMilestone(p, 'm1', LATER);
    expect(p.milestones.map((m) => m.id)).toEqual(['m2']);
    expect(toggleMilestone(p, 'missing', LATER)).toBe(p);
  });

  it('sorts active, paused, done, newest first', () => {
    const mk = (id: string, status: 'active' | 'paused' | 'done', createdAt: string) => ({
      ...createProject({ name: id }, id, createdAt),
      status,
    });
    const sorted = sortProjects([
      mk('done', 'done', LATER),
      mk('old', 'active', NOW),
      mk('paused', 'paused', LATER),
      mk('new', 'active', LATER),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(['new', 'old', 'paused', 'done']);
  });

  it('upserts, changes and removes projects in the file', () => {
    let file = upsertProject(emptyFile(), createProject({ name: 'A' }, 'p1', NOW), LATER);
    file = changeProject(file, 'p1', (p) => updateProject(p, { name: 'B' }, LATER), LATER);
    expect(file.projects[0].name).toBe('B');
    expect(changeProject(file, 'nope', (p) => p, LATER)).toBe(file);
    expect(removeProject(file, 'p1', LATER).projects).toEqual([]);
  });
});

describe('focus time per project', () => {
  const s = (projectId: string | null, minutes: number): FocusSession => ({
    id: Math.random().toString(),
    start: NOW,
    end: NOW,
    minutes,
    projectId,
    tag: null,
  });

  it('sums minutes of sessions tagged with each project', () => {
    const totals = focusMinutesByProject([s('a', 25), s('b', 50), s('a', 30), s(null, 90), s('a', NaN), s('b', -5)]);
    expect(totals.get('a')).toBe(55);
    expect(totals.get('b')).toBe(50);
    expect(totals.size).toBe(2);
  });
});

describe('weekly goals', () => {
  it('allows at most 3 goals per week', () => {
    let file = emptyFile();
    for (const [i, text] of ['Ship v1', 'Run 3x', 'Call mom', 'One too many'].entries()) {
      file = addWeeklyGoal(file, text, `g${i}`, WEEK, NOW);
    }
    expect(goalsForWeek(file, WEEK).map((g) => g.text)).toEqual(['Ship v1', 'Run 3x', 'Call mom']);
    expect(canAddGoal(file, WEEK)).toBe(false);
    // Another week has its own 3.
    expect(canAddGoal(file, '2026-11-30')).toBe(true);
    expect(addWeeklyGoal(file, 'Next week', 'g9', '2026-11-30', NOW).weeklyGoals).toHaveLength(4);
  });

  it('ignores empty goals', () => {
    const file = emptyFile();
    expect(addWeeklyGoal(file, '   ', 'g1', WEEK, NOW)).toBe(file);
  });

  it('checks off and removes goals', () => {
    let file = addWeeklyGoal(emptyFile(), 'Ship v1', 'g1', WEEK, NOW);
    file = toggleWeeklyGoal(file, 'g1', LATER);
    expect(file.weeklyGoals[0]).toMatchObject({ done: true, updatedAt: LATER });
    file = toggleWeeklyGoal(file, 'g1', LATER);
    expect(file.weeklyGoals[0].done).toBe(false);
    file = removeWeeklyGoal(file, 'g1', LATER);
    expect(file.weeklyGoals).toEqual([]);
    expect(canAddGoal(file, WEEK)).toBe(true);
  });
});

describe('normalizeProjectsFile', () => {
  it('fills in missing fields from older data', () => {
    const file = normalizeProjectsFile(
      {
        projects: [{ id: 'p', name: 'A', color: 'javascript:', status: 'x' as never, createdAt: NOW } as never],
        weeklyGoals: [{ id: 'g', weekStart: WEEK, text: 'T', done: false } as never],
      },
      LATER,
    );
    expect(file.projects[0]).toMatchObject({ color: '#4f7a64', status: 'active', milestones: [], updatedAt: NOW });
    expect(file.weeklyGoals[0].updatedAt).toBe(LATER);
    expect(normalizeProjectsFile(undefined, NOW)).toEqual({ projects: [], weeklyGoals: [], updatedAt: NOW });
  });
});
