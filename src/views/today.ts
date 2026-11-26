import {
  findLatestCheckInBefore,
  getAllHabitTicks,
  getDay,
  getHabits,
  getProjects,
  updateDay,
  updateProjects,
} from '../data/db';
import { addDays, isDateKey, relativeDayLabel, formatShortDate, startOfWeek, todayKey } from '../logic/dates';
import {
  applyCheckIn,
  applyNote,
  checkInDefaults,
  emptyDay,
  NOTE_MAX_LENGTH,
  toggleHabitTick,
  type CheckInDefaults,
  type CheckInPatch,
} from '../logic/day';
import { totalFocusMinutes } from '../logic/focus';
import { habitStatus } from '../logic/habits';
import {
  MAX_WEEKLY_GOALS,
  RATINGS,
  type DateKey,
  type DayRecord,
  type Habit,
  type ProjectsFile,
  type Rating,
} from '../logic/model';
import {
  addWeeklyGoal,
  canAddGoal,
  GOAL_MAX_LENGTH,
  goalsForWeek,
  removeWeeklyGoal,
  toggleWeeklyGoal,
} from '../logic/projects';
import { routeHash } from '../logic/routes';
import {
  formatDuration,
  isTimeOfDay,
  shiftTime,
  sleepDurationMinutes,
  TIME_STEP_MINUTES,
} from '../logic/sleep';
import { getTimer, onSessionSaved, subscribe as subscribeTimer } from '../focus/timer';
import { escapeHtml } from './html';
import type { View } from './view';

type TimeField = 'bedtime' | 'wakeTime';
type RatingField = 'sleepQuality' | 'energy' | 'mood';

const RATING_QUESTIONS: { field: RatingField; label: string; low: string; high: string }[] = [
  { field: 'sleepQuality', label: 'Sleep quality', low: 'Restless', high: 'Deep' },
  { field: 'energy', label: 'Energy', low: 'Drained', high: 'Charged' },
  { field: 'mood', label: 'Mood', low: 'Low', high: 'Bright' },
];

const NOTE_SAVE_DELAY_MS = 400;
const REMOVE_CONFIRM_MS = 3000;

const CHECK_SVG = `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const REMOVE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export function dayHash(date: DateKey, today: DateKey): string {
  return date === today ? routeHash('today') : `${routeHash('today')}/${date}`;
}

/** Today screen. `dateParam` comes from the URL (#/today/YYYY-MM-DD) and may be missing or invalid. */
export function createTodayView(dateParam: string | null): View {
  const today = todayKey();
  const date = dateParam && isDateKey(dateParam) && dateParam <= today ? dateParam : today;

  const el = document.createElement('section');
  el.className = 'view today';
  el.innerHTML = `
    <header class="date-nav">
      <a class="icon-button" data-prev href="${dayHash(addDays(date, -1), today)}" aria-label="Previous day">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      </a>
      <div class="date-title">
        <h1>${relativeDayLabel(date, today)}</h1>
        <p>${date === today ? formatShortDate(date, today) : `<a href="${routeHash('today')}">Back to today</a>`}</p>
      </div>
      ${
        date < today
          ? `<a class="icon-button" href="${dayHash(addDays(date, 1), today)}" aria-label="Next day">
               <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
             </a>`
          : `<span class="icon-button" aria-hidden="true"></span>`
      }
    </header>
    <div class="today-body" aria-busy="true"></div>
  `;
  const body = el.querySelector<HTMLDivElement>('.today-body')!;

  let day: DayRecord = emptyDay(date, new Date().toISOString());
  let defaults: CheckInDefaults = checkInDefaults(null);
  let habits: Habit[] = [];
  let ticks = new Map<string, Set<DateKey>>();
  let projectsFile: ProjectsFile = { projects: [], weeklyGoals: [], updatedAt: new Date().toISOString() };
  let projectWrites: Promise<unknown> = Promise.resolve();
  const weekStart = startOfWeek(date);
  const isCurrentWeek = weekStart === startOfWeek(today);
  let destroyed = false;
  let writes: Promise<unknown> = Promise.resolve();
  let noteTimer: number | undefined;
  let statusTimer: number | undefined;

  const status = document.createElement('p');
  status.className = 'save-status';
  status.setAttribute('aria-live', 'polite');

  function showStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle('error', isError);
    status.classList.add('visible');
    window.clearTimeout(statusTimer);
    if (!isError) statusTimer = window.setTimeout(() => status.classList.remove('visible'), 1200);
  }

  /** Updates the screen at once, then writes the same change to IndexedDB in order. */
  function save(change: (d: DayRecord) => DayRecord): void {
    day = change(day);
    update();
    writes = writes
      .then(() => updateDay(date, change))
      .then(
        () => showStatus('Saved'),
        (error: unknown) => {
          console.error('Saving failed', error);
          showStatus('Couldn’t save on this device. Your last change may be lost.', true);
        },
      );
  }

  /** Same as save(), for projects.json (weekly goals). */
  function saveProjects(change: (f: ProjectsFile) => ProjectsFile): void {
    projectsFile = change(projectsFile);
    renderGoals();
    projectWrites = projectWrites
      .then(() => updateProjects(change))
      .then(
        () => showStatus('Saved'),
        (error: unknown) => {
          console.error('Saving goals failed', error);
          showStatus('Couldn’t save on this device. Your last change may be lost.', true);
        },
      );
  }

  const nowIso = () => new Date().toISOString();
  const saveCheckIn = (patch: CheckInPatch) => save((d) => applyCheckIn(d, patch, defaults, nowIso()));

  function flushNote(): void {
    if (noteTimer === undefined) return;
    window.clearTimeout(noteTimer);
    noteTimer = undefined;
    const value = noteInput.value;
    save((d) => applyNote(d, value, nowIso()));
  }

  // ---- Markup ----
  body.innerHTML = `
    <section class="card goals" aria-labelledby="goals-title">
      <div class="card-head">
        <h2 id="goals-title">${isCurrentWeek ? 'This week' : `Week of ${formatShortDate(weekStart, today)}`}</h2>
        <a class="card-link" href="${routeHash('projects')}">Projects</a>
      </div>
      <ul class="goal-list" data-goal-list></ul>
      <form class="add-row" data-add-goal hidden>
        <label class="visually-hidden" for="new-goal">New goal for this week</label>
        <input id="new-goal" name="goal" maxlength="${GOAL_MAX_LENGTH}" autocomplete="off" enterkeyhint="done"
          placeholder="What matters most this week?" />
        <button type="submit" class="step">Add</button>
      </form>
    </section>
    <section class="card" aria-labelledby="sleep-title">
      <div class="card-head">
        <h2 id="sleep-title">Sleep</h2>
        <span class="sleep-total" data-sleep-total></span>
      </div>
      ${timeRow('bedtime', 'Bedtime')}
      ${timeRow('wakeTime', 'Woke up')}
      <p class="hint" data-hint hidden></p>
    </section>
    <section class="card ratings">
      ${RATING_QUESTIONS.map(
        (q) => `
        <div class="rating" role="radiogroup" aria-labelledby="rating-${q.field}">
          <div class="rating-head">
            <h3 id="rating-${q.field}">${q.label}</h3>
            <span class="rating-scale">${q.low} → ${q.high}</span>
          </div>
          <div class="rating-options">
            ${RATINGS.map(
              (r) =>
                `<button type="button" role="radio" aria-checked="false" data-rating="${q.field}" data-value="${r}"
                   aria-label="${q.label} ${r} of 5">${r}</button>`,
            ).join('')}
          </div>
        </div>`,
      ).join('')}
    </section>
    <section class="card habits" aria-labelledby="habits-title">
      <div class="card-head">
        <h2 id="habits-title">Habits</h2>
        <a class="card-link" href="${routeHash('settings')}">Edit</a>
      </div>
      <div class="habit-list" data-habit-list></div>
    </section>
    <a class="card focus-summary" href="${routeHash('focus')}">
      <span class="focus-summary-text">
        <span class="focus-summary-label">Focus</span>
        <span class="focus-summary-meta" data-focus-meta></span>
      </span>
      <span class="focus-summary-total" data-focus-total></span>
    </a>
    <section class="card note">
      <label for="day-note" class="visually-hidden">Note for the day</label>
      <input id="day-note" type="text" maxlength="${NOTE_MAX_LENGTH}" autocomplete="off" enterkeyhint="done"
        placeholder="One line about the day (optional)" />
    </section>
  `;
  body.append(status);

  const noteInput = body.querySelector<HTMLInputElement>('#day-note')!;
  const timeInputs = {
    bedtime: body.querySelector<HTMLInputElement>('[data-time-input="bedtime"]')!,
    wakeTime: body.querySelector<HTMLInputElement>('[data-time-input="wakeTime"]')!,
  };
  const sleepTotal = body.querySelector<HTMLElement>('[data-sleep-total]')!;
  const hint = body.querySelector<HTMLElement>('[data-hint]')!;
  const ratingButtons = body.querySelectorAll<HTMLButtonElement>('[data-rating]');
  const habitList = body.querySelector<HTMLElement>('[data-habit-list]')!;
  const goalList = body.querySelector<HTMLElement>('[data-goal-list]')!;
  const goalForm = body.querySelector<HTMLFormElement>('[data-add-goal]')!;
  const removeTimers = new Set<number>();

  /** Up to 3 goals for the shown week; new ones can only be added to the current week. */
  function renderGoals(): void {
    const goals = goalsForWeek(projectsFile, weekStart);
    const left = MAX_WEEKLY_GOALS - goals.length;
    goalList.innerHTML =
      goals
        .map(
          (g) => `
        <li class="goal" data-goal-id="${escapeHtml(g.id)}">
          <button type="button" class="goal-toggle" data-toggle-goal aria-pressed="${g.done}">
            <span class="habit-check" aria-hidden="true">${CHECK_SVG}</span>
            <span class="goal-text">${escapeHtml(g.text)}</span>
          </button>
          <button type="button" class="icon-button goal-remove" data-remove-goal aria-label="Remove goal: ${escapeHtml(g.text)}">
            ${REMOVE_SVG}
          </button>
        </li>`,
        )
        .join('') +
      (goals.length === 0
        ? `<li class="empty">${isCurrentWeek ? `Pick up to ${MAX_WEEKLY_GOALS} things that would make this week a good one.` : 'No goals that week.'}</li>`
        : '');
    const canAdd = isCurrentWeek && canAddGoal(projectsFile, weekStart);
    goalForm.hidden = !canAdd;
    goalForm.querySelector('input')!.placeholder =
      goals.length === 0 ? 'What matters most this week?' : `Add a goal (${left} left)`;
  }
  const focusTotal = body.querySelector<HTMLElement>('[data-focus-total]')!;
  const focusMeta = body.querySelector<HTMLElement>('[data-focus-meta]')!;

  /** Total of saved sessions for the shown day, plus a hint while a timer runs. */
  function updateFocus(): void {
    const sessions = day.focusSessions;
    focusTotal.textContent = formatDuration(totalFocusMinutes(sessions));
    const running = getTimer();
    const parts: string[] = [];
    if (sessions.length > 0) parts.push(`${sessions.length} session${sessions.length === 1 ? '' : 's'}`);
    if (running && running.status !== 'finished' && date === today) {
      parts.push(running.status === 'paused' ? 'Timer paused' : 'Timer running');
    }
    focusMeta.textContent = parts.length ? parts.join(' · ') : date === today ? 'Start a session' : 'No sessions';
  }

  /** Builds the habit buttons; called when the habit list changes. */
  function renderHabits(): void {
    if (habits.length === 0) {
      habitList.innerHTML = `<p class="empty">No habits yet. <a href="${routeHash('settings')}">Add one in Settings</a>.</p>`;
      return;
    }
    habitList.innerHTML = habits
      .map(
        (h) => `
        <button type="button" class="habit" data-habit-id="${escapeHtml(h.id)}" aria-pressed="false">
          <span class="habit-emoji" aria-hidden="true">${escapeHtml(h.emoji)}</span>
          <span class="habit-text">
            <span class="habit-name">${escapeHtml(h.name)}</span>
            <span class="habit-meta" data-habit-meta></span>
          </span>
          <span class="habit-check" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
          </span>
        </button>`,
      )
      .join('');
    updateHabits();
  }

  /** Refreshes ticked state, weekly progress and streaks (as of the shown date). */
  function updateHabits(): void {
    habitList.querySelectorAll<HTMLButtonElement>('[data-habit-id]').forEach((button) => {
      const habit = habits.find((h) => h.id === button.dataset.habitId);
      if (!habit) return;
      const ticked = day.habitTicks.includes(habit.id);
      const status = habitStatus(habit, ticks.get(habit.id) ?? new Set(), date);
      button.setAttribute('aria-pressed', String(ticked));
      button.classList.toggle('week-met', status.met);
      const parts = [`${status.done}/${status.target} this week`];
      if (status.streak > 0) parts.push(`${status.streak}-week streak`);
      button.querySelector('[data-habit-meta]')!.textContent = parts.join(' · ');
    });
  }

  function toggleHabit(id: string): void {
    const set = ticks.get(id) ?? new Set<DateKey>();
    ticks.set(id, set);
    if (day.habitTicks.includes(id)) set.delete(date);
    else set.add(date);
    save((d) => toggleHabitTick(d, id, nowIso()));
  }

  function currentTimes() {
    return {
      bedtime: day.checkIn?.bedtime ?? defaults.bedtime,
      wakeTime: day.checkIn?.wakeTime ?? defaults.wakeTime,
    };
  }

  /** Reflects the current state in the DOM (except the note, which the user types into). */
  function update(): void {
    const times = currentTimes();
    for (const field of ['bedtime', 'wakeTime'] as const) {
      if (document.activeElement !== timeInputs[field]) timeInputs[field].value = times[field];
    }
    sleepTotal.textContent = formatDuration(sleepDurationMinutes(times.bedtime, times.wakeTime));

    const suggested = !day.checkIn;
    hint.hidden = !suggested;
    hint.textContent = defaults.fromPrevious
      ? 'Times suggested from your last check-in. Adjust or just answer below.'
      : 'Suggested times. Adjust or just answer below.';
    body.classList.toggle('is-suggested', suggested);

    ratingButtons.forEach((button) => {
      const field = button.dataset.rating as RatingField;
      const checked = day.checkIn?.[field] === Number(button.dataset.value);
      button.setAttribute('aria-checked', String(checked));
    });
    // Roving tabindex: one tab stop per rating group.
    for (const q of RATING_QUESTIONS) {
      const group = [...ratingButtons].filter((b) => b.dataset.rating === q.field);
      const active = group.find((b) => b.getAttribute('aria-checked') === 'true') ?? group[0];
      group.forEach((b) => (b.tabIndex = b === active ? 0 : -1));
    }
    updateHabits();
    updateFocus();
  }

  // ---- Events ----
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const goalRow = target.closest<HTMLElement>('[data-goal-id]');
    if (goalRow) {
      const id = goalRow.dataset.goalId!;
      if (target.closest('[data-toggle-goal]')) {
        saveProjects((f) => toggleWeeklyGoal(f, id, nowIso()));
        goalList.querySelector<HTMLElement>(`[data-goal-id="${CSS.escape(id)}"] [data-toggle-goal]`)?.focus();
        return;
      }
      const remove = target.closest<HTMLButtonElement>('[data-remove-goal]');
      if (remove) {
        // Two taps, so a stray touch doesn't remove a goal.
        if (!remove.classList.contains('armed')) {
          const label = remove.getAttribute('aria-label')!;
          remove.classList.add('armed');
          remove.setAttribute('aria-label', 'Tap again to remove');
          const t = window.setTimeout(() => {
            remove.classList.remove('armed');
            remove.setAttribute('aria-label', label);
            removeTimers.delete(t);
          }, REMOVE_CONFIRM_MS);
          removeTimers.add(t);
          return;
        }
        saveProjects((f) => removeWeeklyGoal(f, id, nowIso()));
      }
      return;
    }
    const step = target.closest<HTMLButtonElement>('[data-step]');
    if (step) {
      const field = step.dataset.field as TimeField;
      const delta = Number(step.dataset.step);
      saveCheckIn({ [field]: shiftTime(currentTimes()[field], delta) });
      return;
    }
    const habitButton = target.closest<HTMLButtonElement>('[data-habit-id]');
    if (habitButton) {
      toggleHabit(habitButton.dataset.habitId!);
      return;
    }
    const rating = target.closest<HTMLButtonElement>('[data-rating]');
    if (rating) {
      saveCheckIn({ [rating.dataset.rating as RatingField]: Number(rating.dataset.value) as Rating });
    }
  });

  body.addEventListener('keydown', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rating]');
    if (!button) return;
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const field = button.dataset.rating as RatingField;
    const value = Math.min(5, Math.max(1, Number(button.dataset.value) + delta)) as Rating;
    saveCheckIn({ [field]: value });
    body.querySelector<HTMLButtonElement>(`[data-rating="${field}"][data-value="${value}"]`)?.focus();
  });

  for (const field of ['bedtime', 'wakeTime'] as const) {
    const input = timeInputs[field];
    input.addEventListener('change', () => {
      if (isTimeOfDay(input.value)) saveCheckIn({ [field]: input.value });
      else update();
    });
    input.addEventListener('blur', () => update());
  }

  goalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = goalForm.querySelector<HTMLInputElement>('input')!;
    const text = input.value.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    saveProjects((f) => addWeeklyGoal(f, text, id, weekStart, nowIso()));
    input.value = '';
    if (!goalForm.hidden) input.focus();
  });

  noteInput.addEventListener('input', () => {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(flushNote, NOTE_SAVE_DELAY_MS);
  });
  noteInput.addEventListener('blur', flushNote);
  noteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') noteInput.blur();
  });

  const onHide = () => {
    if (document.visibilityState === 'hidden') flushNote();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushNote);

  // A focus session can finish (and save) while this screen is open.
  const unsubscribeTimer = subscribeTimer(() => {
    if (!destroyed) updateFocus();
  });
  const unsubscribeSaved = onSessionSaved((savedDate) => {
    if (savedDate !== date) return;
    getDay(date)
      .then((stored) => {
        if (destroyed || !stored) return;
        day = { ...day, focusSessions: stored.focusSessions };
        updateFocus();
      })
      .catch((error: unknown) => console.error('Reloading focus sessions failed', error));
  });

  // ---- Load ----
  Promise.all([getDay(date), findLatestCheckInBefore(date), getHabits(), getAllHabitTicks(), getProjects()])
    .then(([stored, previous, habitsFile, allTicks, projects]) => {
      if (destroyed) return;
      projectsFile = projects;
      renderGoals();
      if (stored) day = stored;
      habits = habitsFile.habits;
      ticks = allTicks;
      renderHabits();
      defaults = checkInDefaults(previous);
      noteInput.value = day.note;
      update();
      body.removeAttribute('aria-busy');
    })
    .catch((error: unknown) => {
      console.error('Loading failed', error);
      if (destroyed) return;
      renderGoals();
      renderHabits();
      update();
      body.removeAttribute('aria-busy');
      showStatus('Couldn’t open local storage. Changes won’t be kept.', true);
    });

  update();

  return {
    el,
    destroy() {
      flushNote();
      destroyed = true;
      window.clearTimeout(statusTimer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushNote);
      unsubscribeTimer();
      unsubscribeSaved();
      removeTimers.forEach((t) => window.clearTimeout(t));
    },
  };
}

function timeRow(field: TimeField, label: string): string {
  return `
    <div class="time-row">
      <label for="time-${field}">${label}</label>
      <div class="stepper">
        <button type="button" class="step" data-field="${field}" data-step="${-TIME_STEP_MINUTES}"
          aria-label="${label} 15 minutes earlier">−15</button>
        <input id="time-${field}" type="time" data-time-input="${field}" step="${TIME_STEP_MINUTES * 60}" required />
        <button type="button" class="step" data-field="${field}" data-step="${TIME_STEP_MINUTES}"
          aria-label="${label} 15 minutes later">+15</button>
      </div>
    </div>`;
}
