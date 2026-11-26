import { getHabits, updateHabits } from '../data/db';
import { todayKey } from '../logic/dates';
import {
  createHabit,
  DEFAULT_EMOJI,
  DEFAULT_TARGET,
  MAX_TARGET,
  MIN_TARGET,
  NAME_MAX_LENGTH,
  updateHabit,
  type HabitPatch,
} from '../logic/habits';
import type { Habit, HabitsFile } from '../logic/model';
import { escapeHtml } from './html';
import type { View } from './view';

const TEXT_SAVE_DELAY_MS = 400;
const DELETE_CONFIRM_MS = 3000;

const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

const targetLabel = (n: number) => (n === 7 ? 'Every day' : `${n} day${n === 1 ? '' : 's'} a week`);

export function createSettingsView(): View {
  const el = document.createElement('section');
  el.className = 'view settings';
  el.innerHTML = `
    <header class="view-header"><h1>Settings</h1></header>
    <section class="card" aria-labelledby="habits-settings-title">
      <div class="card-head">
        <h2 id="habits-settings-title">Habits</h2>
      </div>
      <p class="card-sub">Streaks count weeks that reach the target, so rest days are fine.</p>
      <ul class="habit-editors" data-habit-editors aria-live="polite"></ul>
      <form class="add-habit" data-add-habit>
        <label class="visually-hidden" for="new-habit-emoji">Emoji for new habit</label>
        <input id="new-habit-emoji" class="emoji-input" name="emoji" placeholder="${DEFAULT_EMOJI}" autocomplete="off" />
        <label class="visually-hidden" for="new-habit-name">New habit name</label>
        <input id="new-habit-name" class="name-input" name="name" maxlength="${NAME_MAX_LENGTH}"
          placeholder="New habit" autocomplete="off" enterkeyhint="done" required />
        <button type="submit" class="primary">Add</button>
      </form>
    </section>
    <section class="card placeholder">
      <p>GitHub sync, export and import will be set up here.</p>
    </section>
    <p class="save-status" aria-live="polite" data-status></p>
  `;

  const list = el.querySelector<HTMLUListElement>('[data-habit-editors]')!;
  const addForm = el.querySelector<HTMLFormElement>('[data-add-habit]')!;
  const status = el.querySelector<HTMLElement>('[data-status]')!;

  let habits: Habit[] = [];
  let writes: Promise<unknown> = Promise.resolve();
  let statusTimer: number | undefined;
  let destroyed = false;
  const textTimers = new Map<string, number>();
  const deleteTimers = new Map<string, number>();

  const nowIso = () => new Date().toISOString();

  function showStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle('error', isError);
    status.classList.add('visible');
    window.clearTimeout(statusTimer);
    if (!isError) statusTimer = window.setTimeout(() => status.classList.remove('visible'), 1200);
  }

  /** Updates the list at once and writes the same change to IndexedDB, in order. */
  function save(change: (file: HabitsFile) => HabitsFile): void {
    habits = change({ habits, updatedAt: nowIso() }).habits;
    writes = writes
      .then(() => updateHabits(change))
      .then(
        () => showStatus('Saved'),
        (error: unknown) => {
          console.error('Saving habits failed', error);
          showStatus('Couldn’t save on this device. Your last change may be lost.', true);
        },
      );
  }

  function editHabit(id: string, patch: HabitPatch): void {
    const today = todayKey();
    save((file) => ({
      habits: file.habits.map((h) => (h.id === id ? updateHabit(h, patch, today, nowIso()) : h)),
      updatedAt: nowIso(),
    }));
  }

  function render(): void {
    if (habits.length === 0) {
      list.innerHTML = `<li class="empty">No habits yet. Add your first one below.</li>`;
      return;
    }
    list.innerHTML = habits
      .map(
        (h) => `
        <li class="habit-editor" data-id="${escapeHtml(h.id)}">
          <input class="emoji-input" data-field="emoji" value="${escapeHtml(h.emoji)}" autocomplete="off"
            aria-label="Emoji for ${escapeHtml(h.name)}" />
          <input class="name-input" data-field="name" value="${escapeHtml(h.name)}" maxlength="${NAME_MAX_LENGTH}"
            autocomplete="off" enterkeyhint="done" aria-label="Name" />
          <button type="button" class="icon-button delete" data-delete aria-label="Delete ${escapeHtml(h.name)}">
            ${TRASH_ICON}<span class="delete-confirm">Delete?</span>
          </button>
          <div class="target-row">
            <span class="target-label" data-target-label>${targetLabel(h.targetPerWeek)}</span>
            <div class="stepper">
              <button type="button" class="step" data-target-step="-1" aria-label="Fewer days per week"
                ${h.targetPerWeek <= MIN_TARGET ? 'disabled' : ''}>−</button>
              <button type="button" class="step" data-target-step="1" aria-label="More days per week"
                ${h.targetPerWeek >= MAX_TARGET ? 'disabled' : ''}>+</button>
            </div>
          </div>
        </li>`,
      )
      .join('');
  }

  /** Updates one row's target without rebuilding the list (keeps focus on the button). */
  function updateTargetRow(row: HTMLElement, target: number): void {
    row.querySelector('[data-target-label]')!.textContent = targetLabel(target);
    row.querySelector<HTMLButtonElement>('[data-target-step="-1"]')!.disabled = target <= MIN_TARGET;
    row.querySelector<HTMLButtonElement>('[data-target-step="1"]')!.disabled = target >= MAX_TARGET;
  }

  function flushText(row: HTMLElement): void {
    const id = row.dataset.id!;
    const timer = textTimers.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    textTimers.delete(id);
    const name = row.querySelector<HTMLInputElement>('[data-field="name"]')!.value;
    const emoji = row.querySelector<HTMLInputElement>('[data-field="emoji"]')!.value;
    editHabit(id, { name, emoji });
  }

  function flushAllText(): void {
    list.querySelectorAll<HTMLElement>('.habit-editor').forEach(flushText);
  }

  // ---- Events ----
  list.addEventListener('input', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.habit-editor');
    if (!row) return;
    const id = row.dataset.id!;
    window.clearTimeout(textTimers.get(id));
    textTimers.set(id, window.setTimeout(() => flushText(row), TEXT_SAVE_DELAY_MS));
  });

  // On leaving a field, save and show the cleaned-up value (e.g. one emoji, no empty name).
  list.addEventListener('focusout', (event) => {
    const input = event.target as HTMLInputElement;
    const row = input.closest<HTMLElement>('.habit-editor');
    if (!row || !input.dataset.field) return;
    flushText(row);
    const habit = habits.find((h) => h.id === row.dataset.id);
    if (habit) input.value = input.dataset.field === 'emoji' ? habit.emoji : habit.name;
  });

  list.addEventListener('keydown', (event) => {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter' && input.dataset.field) input.blur();
  });

  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.habit-editor');
    if (!row) return;
    const id = row.dataset.id!;

    const step = target.closest<HTMLButtonElement>('[data-target-step]');
    if (step) {
      const habit = habits.find((h) => h.id === id);
      if (!habit) return;
      const next = habit.targetPerWeek + Number(step.dataset.targetStep);
      editHabit(id, { targetPerWeek: next });
      updateTargetRow(row, habits.find((h) => h.id === id)!.targetPerWeek);
      return;
    }

    const del = target.closest<HTMLButtonElement>('[data-delete]');
    if (del) {
      // Two taps to delete: the first arms the button for a few seconds.
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.setAttribute('aria-label', 'Tap again to delete');
        deleteTimers.set(
          id,
          window.setTimeout(() => {
            del.classList.remove('armed');
            del.setAttribute('aria-label', `Delete ${habits.find((h) => h.id === id)?.name ?? 'habit'}`);
          }, DELETE_CONFIRM_MS),
        );
        return;
      }
      window.clearTimeout(deleteTimers.get(id));
      window.clearTimeout(textTimers.get(id));
      textTimers.delete(id);
      save((file) => ({ habits: file.habits.filter((h) => h.id !== id), updatedAt: nowIso() }));
      render();
    }
  });

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(addForm);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    const habit = createHabit(
      { name, emoji: String(data.get('emoji') ?? ''), targetPerWeek: DEFAULT_TARGET },
      crypto.randomUUID(),
      todayKey(),
      nowIso(),
    );
    save((file) => ({ habits: [...file.habits, habit], updatedAt: nowIso() }));
    render();
    addForm.reset();
    addForm.querySelector<HTMLInputElement>('#new-habit-name')!.focus();
  });

  const onHide = () => {
    if (document.visibilityState === 'hidden') flushAllText();
  };
  document.addEventListener('visibilitychange', onHide);

  // ---- Load ----
  getHabits()
    .then((file) => {
      if (destroyed) return;
      habits = file.habits;
      render();
    })
    .catch((error: unknown) => {
      console.error('Loading habits failed', error);
      if (!destroyed) showStatus('Couldn’t open local storage. Changes won’t be kept.', true);
    });

  return {
    el,
    destroy() {
      flushAllText();
      destroyed = true;
      window.clearTimeout(statusTimer);
      deleteTimers.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}
