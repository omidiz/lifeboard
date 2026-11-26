/**
 * Three-way merge for sync conflicts: when the same file changed on two
 * devices, combine `local` and `remote` using `base`, the version both
 * last agreed on (null when this device has never synced the file).
 *
 * Rules (see CLAUDE.md):
 *  - Habit ticks and focus sessions: union of what either side added; an
 *    item removed on one side since the base stays removed.
 *  - Check-in: field by field. A field changed on one side only takes that
 *    change; changed on both, the later check-in wins. An answer always
 *    beats "not answered yet".
 *  - Note: the later note wins.
 *  - Habits, projects, milestones, weekly goals: matched by id, merged field
 *    by field the same way. A deletion wins unless the other side edited
 *    the item since the base, so an edit is never silently lost.
 *
 * Ties are broken the same way on every device, so both sides of a
 * conflict always arrive at the same result.
 */
import { deepEqual, stableStringify } from './json';
import type {
  CheckIn,
  DayRecord,
  FocusSession,
  Habit,
  HabitsFile,
  Milestone,
  Project,
  ProjectsFile,
  WeeklyGoal,
} from './model';

type Side = 'local' | 'remote';

const maxIso = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

/**
 * Which side wins when both changed the same thing: the later timestamp;
 * on a tie, a fixed order of the values, so the merge is symmetric.
 */
function newerSide(
  localTime: string | null | undefined,
  remoteTime: string | null | undefined,
  local: unknown,
  remote: unknown,
): Side {
  const l = localTime ?? '';
  const r = remoteTime ?? '';
  if (l !== r) return l > r ? 'local' : 'remote';
  return stableStringify(local) >= stableStringify(remote) ? 'local' : 'remote';
}

/** Which side's value to keep: the one that changed since the base, else the tie-breaker. */
function chooseSide<T>(base: T | undefined, local: T, remote: T, tie: Side): Side {
  if (base !== undefined) {
    if (deepEqual(base, local)) return 'remote';
    if (deepEqual(base, remote)) return 'local';
  }
  return tie;
}

/** Three-way merge of a single value. `base` undefined means "unknown". */
export function mergeValue<T>(base: T | undefined, local: T, remote: T, tie: Side): T {
  if (deepEqual(local, remote)) return local;
  return chooseSide(base, local, remote, tie) === 'local' ? local : remote;
}

/** Merges the listed fields one by one; other fields come from the tie-breaking side. */
function mergeFields<T extends object>(base: T | undefined, local: T, remote: T, keys: readonly (keyof T)[], tie: Side): T {
  const out = { ...(tie === 'local' ? local : remote) };
  for (const key of keys) out[key] = mergeValue(base?.[key], local[key], remote[key], tie);
  return out;
}

/**
 * Merges lists of items with ids. Items on both sides are merged with
 * `mergeItem`. An item on one side only is kept if it is new (not in the
 * base) or was edited since the base; otherwise the other side deleted it.
 * Without a base, nothing counts as deleted: the result is the union.
 */
function mergeById<T extends { id: string }>(
  base: readonly T[] | null,
  local: readonly T[],
  remote: readonly T[],
  mergeItem: (base: T | undefined, local: T, remote: T) => T,
): T[] {
  const baseById = new Map((base ?? []).map((x) => [x.id, x]));
  const localById = new Map(local.map((x) => [x.id, x]));
  const remoteById = new Map(remote.map((x) => [x.id, x]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const out: T[] = [];
  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    const b = baseById.get(id);
    if (l && r) out.push(mergeItem(b, l, r));
    else {
      const only = (l ?? r)!;
      if (!b || !deepEqual(only, b)) out.push(only);
    }
  }
  return out;
}

/** Union of additions on either side, minus removals on either side since the base. */
export function mergeIdSet(base: readonly string[] | null, local: readonly string[], remote: readonly string[]): string[] {
  const b = new Set(base ?? []);
  const l = new Set(local);
  const r = new Set(remote);
  return [...new Set([...l, ...r])].filter((x) => (l.has(x) && r.has(x)) || !b.has(x)).sort();
}

const byCreated = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

// ---------- Day files ----------

const TIME_FIELDS = ['bedtime', 'wakeTime'] as const;
const RATING_FIELDS = ['sleepQuality', 'energy', 'mood'] as const;

export function mergeCheckIn(base: CheckIn | null, local: CheckIn | null, remote: CheckIn | null): CheckIn | null {
  if (!local || !remote) return local ?? remote;
  const tie = newerSide(local.updatedAt, remote.updatedAt, local, remote);
  const merged: CheckIn = { ...(tie === 'local' ? local : remote) };
  for (const field of TIME_FIELDS) {
    merged[field] = mergeValue(base?.[field], local[field], remote[field], tie);
  }
  // Before the first check-in nothing was answered, so an answer beats null.
  for (const field of RATING_FIELDS) {
    merged[field] = mergeValue(base ? base[field] : null, local[field], remote[field], tie);
  }
  merged.updatedAt = maxIso(local.updatedAt, remote.updatedAt)!;
  return merged;
}

function mergeSession(base: FocusSession | undefined, local: FocusSession, remote: FocusSession): FocusSession {
  // The same session differs when it was extended (+5 min): the later end wins.
  return mergeValue(base, local, remote, newerSide(local.end, remote.end, local, remote));
}

export function mergeDay(base: DayRecord | null, local: DayRecord, remote: DayRecord): DayRecord {
  let note = local.note;
  let noteUpdatedAt = maxIso(local.noteUpdatedAt, remote.noteUpdatedAt);
  if (local.note !== remote.note) {
    const tie = newerSide(local.noteUpdatedAt, remote.noteUpdatedAt, local.note, remote.note);
    const side = chooseSide(base?.note, local.note, remote.note, tie);
    const winner = side === 'local' ? local : remote;
    note = winner.note;
    noteUpdatedAt = winner.noteUpdatedAt;
  }

  const focusSessions = mergeById(base?.focusSessions ?? null, local.focusSessions, remote.focusSessions, mergeSession);
  focusSessions.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  return {
    ...remote,
    ...local,
    checkIn: mergeCheckIn(base?.checkIn ?? null, local.checkIn, remote.checkIn),
    habitTicks: mergeIdSet(base?.habitTicks ?? null, local.habitTicks, remote.habitTicks),
    focusSessions,
    note,
    noteUpdatedAt,
    updatedAt: maxIso(local.updatedAt, remote.updatedAt)!,
  };
}

// ---------- habits.json ----------

const HABIT_FIELDS = ['name', 'emoji', 'targetPerWeek', 'targetHistory', 'createdOn', 'createdAt'] as const;

function mergeHabit(base: Habit | undefined, local: Habit, remote: Habit): Habit {
  const tie = newerSide(local.updatedAt, remote.updatedAt, local, remote);
  return {
    ...mergeFields(base, local, remote, HABIT_FIELDS, tie),
    updatedAt: maxIso(local.updatedAt, remote.updatedAt)!,
  };
}

export function mergeHabits(base: HabitsFile | null, local: HabitsFile, remote: HabitsFile): HabitsFile {
  return {
    ...remote,
    ...local,
    habits: mergeById(base?.habits ?? null, local.habits, remote.habits, mergeHabit).sort(byCreated),
    updatedAt: maxIso(local.updatedAt, remote.updatedAt)!,
  };
}

// ---------- projects.json ----------

const PROJECT_FIELDS = ['name', 'color', 'status', 'createdAt'] as const;
const MILESTONE_FIELDS = ['title', 'done'] as const;
const GOAL_FIELDS = ['weekStart', 'text', 'done'] as const;

function mergeProject(base: Project | undefined, local: Project, remote: Project): Project {
  const tie = newerSide(local.updatedAt, remote.updatedAt, local, remote);
  // Milestones are merged one by one, so checking different ones on two devices keeps both.
  const milestones = mergeById<Milestone>(base?.milestones ?? null, local.milestones, remote.milestones, (b, l, r) =>
    mergeFields(b, l, r, MILESTONE_FIELDS, tie),
  );
  return {
    ...mergeFields(base, local, remote, PROJECT_FIELDS, tie),
    milestones,
    updatedAt: maxIso(local.updatedAt, remote.updatedAt)!,
  };
}

function mergeGoal(base: WeeklyGoal | undefined, local: WeeklyGoal, remote: WeeklyGoal): WeeklyGoal {
  const tie = newerSide(local.updatedAt, remote.updatedAt, local, remote);
  return { ...mergeFields(base, local, remote, GOAL_FIELDS, tie), updatedAt: maxIso(local.updatedAt, remote.updatedAt)! };
}

/**
 * Merges projects.json. Goals added offline on two devices can leave a week
 * with more than 3; all are kept (nothing is lost) and the Today screen
 * simply won't offer adding more until the week is back under the limit.
 */
export function mergeProjects(base: ProjectsFile | null, local: ProjectsFile, remote: ProjectsFile): ProjectsFile {
  return {
    ...remote,
    ...local,
    projects: mergeById(base?.projects ?? null, local.projects, remote.projects, mergeProject).sort(byCreated),
    weeklyGoals: mergeById(base?.weeklyGoals ?? null, local.weeklyGoals, remote.weeklyGoals, mergeGoal),
    updatedAt: maxIso(local.updatedAt, remote.updatedAt)!,
  };
}
