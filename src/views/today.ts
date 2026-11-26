import { findLatestCheckInBefore, getDay, updateDay } from '../data/db';
import { addDays, isDateKey, relativeDayLabel, formatShortDate, todayKey } from '../logic/dates';
import {
  applyCheckIn,
  applyNote,
  checkInDefaults,
  emptyDay,
  NOTE_MAX_LENGTH,
  type CheckInDefaults,
  type CheckInPatch,
} from '../logic/day';
import { RATINGS, type DateKey, type DayRecord, type Rating } from '../logic/model';
import { routeHash } from '../logic/routes';
import {
  formatDuration,
  isTimeOfDay,
  shiftTime,
  sleepDurationMinutes,
  TIME_STEP_MINUTES,
} from '../logic/sleep';
import type { View } from './view';

type TimeField = 'bedtime' | 'wakeTime';
type RatingField = 'sleepQuality' | 'energy' | 'mood';

const RATING_QUESTIONS: { field: RatingField; label: string; low: string; high: string }[] = [
  { field: 'sleepQuality', label: 'Sleep quality', low: 'Restless', high: 'Deep' },
  { field: 'energy', label: 'Energy', low: 'Drained', high: 'Charged' },
  { field: 'mood', label: 'Mood', low: 'Low', high: 'Bright' },
];

const NOTE_SAVE_DELAY_MS = 400;

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
  }

  // ---- Events ----
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const step = target.closest<HTMLButtonElement>('[data-step]');
    if (step) {
      const field = step.dataset.field as TimeField;
      const delta = Number(step.dataset.step);
      saveCheckIn({ [field]: shiftTime(currentTimes()[field], delta) });
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

  // ---- Load ----
  Promise.all([getDay(date), findLatestCheckInBefore(date)])
    .then(([stored, previous]) => {
      if (destroyed) return;
      if (stored) day = stored;
      defaults = checkInDefaults(previous);
      noteInput.value = day.note;
      update();
      body.removeAttribute('aria-busy');
    })
    .catch((error: unknown) => {
      console.error('Loading failed', error);
      if (destroyed) return;
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
