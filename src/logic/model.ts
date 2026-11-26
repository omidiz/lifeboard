/**
 * Data model, mirroring the JSON files in the lifeboard-data repo:
 *   days/YYYY-MM-DD.json -> DayRecord
 *   habits.json          -> HabitsFile
 *   projects.json        -> ProjectsFile
 */

/** Calendar date in local time, formatted YYYY-MM-DD. */
export type DateKey = string;

/** Wall-clock time, formatted HH:MM (24h). */
export type TimeOfDay = string;

/** 1–5 rating; null when not answered yet. */
export type Rating = 1 | 2 | 3 | 4 | 5;

export const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5];

/**
 * Morning check-in for the night that ended on this day's morning:
 * bedtime is usually the evening before, wake time is this morning.
 */
export interface CheckIn {
  bedtime: TimeOfDay;
  wakeTime: TimeOfDay;
  sleepQuality: Rating | null;
  energy: Rating | null;
  mood: Rating | null;
  /** ISO timestamp of the last change; on sync conflict the latest wins. */
  updatedAt: string;
}

export interface FocusSession {
  id: string;
  /** ISO timestamps. */
  start: string;
  end: string;
  minutes: number;
  projectId: string | null;
  tag: string | null;
}

export interface DayRecord {
  date: DateKey;
  checkIn: CheckIn | null;
  /** Ids of habits ticked on this day. */
  habitTicks: string[];
  focusSessions: FocusSession[];
  note: string;
  /** ISO timestamp of the last note change; on sync conflict the latest wins. */
  noteUpdatedAt: string | null;
  updatedAt: string;
}

/** A weekly target that applies from a given week onwards. */
export interface TargetChange {
  /** Monday of the first week this target applies to. */
  weekStart: DateKey;
  /** Days per week (1–7). */
  target: number;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  /** Current target: how many days per week the habit should be done (1–7). */
  targetPerWeek: number;
  /**
   * Every target the habit has had, oldest first. Past weeks are judged by
   * the target that applied then, so editing a target never rewrites history.
   */
  targetHistory: TargetChange[];
  /** Local date the habit was created. */
  createdOn: DateKey;
  createdAt: string;
  updatedAt: string;
}

export interface HabitsFile {
  habits: Habit[];
  updatedAt: string;
}

export type ProjectStatus = 'active' | 'paused' | 'done';

export interface Milestone {
  id: string;
  title: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  status: ProjectStatus;
  milestones: Milestone[];
  createdAt: string;
  /** ISO timestamp of the last change to this project; on sync conflict the latest wins. */
  updatedAt: string;
}

export interface WeeklyGoal {
  id: string;
  /** Monday of the week the goal belongs to. */
  weekStart: DateKey;
  text: string;
  done: boolean;
  /** ISO timestamp of the last change to this goal. */
  updatedAt: string;
}

export const MAX_WEEKLY_GOALS = 3;

export interface ProjectsFile {
  projects: Project[];
  weeklyGoals: WeeklyGoal[];
  updatedAt: string;
}
