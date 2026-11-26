import { getDay, getProjects } from '../data/db';
import { todayKey } from '../logic/dates';
import { LABEL_MAX_LENGTH, normalizeLabel, totalFocusMinutes } from '../logic/focus';
import type { DateKey, Project } from '../logic/model';
import { formatDuration } from '../logic/sleep';
import {
  elapsedMs,
  formatClock,
  NO_TAG,
  PRESET_MINUTES,
  progress,
  remainingMs,
  type FocusTag,
  type TimerMode,
  type TimerState,
} from '../logic/timer';
import * as timer from '../focus/timer';
import { escapeHtml } from './html';
import type { View } from './view';

const RING_R = 108;
const RING_C = 2 * Math.PI * RING_R;
const CANCEL_CONFIRM_MS = 3000;
const TICK_MS = 250;

type Choice = { mode: 'countdown'; minutes: number } | { mode: 'stopwatch' };

const sameTag = (a: FocusTag, b: FocusTag) => a.projectId === b.projectId && a.label === b.label;

export function createFocusView(): View {
  const el = document.createElement('section');
  el.className = 'view focus';
  el.innerHTML = `
    <header class="view-header"><h1>Focus</h1></header>

    <div class="focus-dial" data-dial>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle class="ring-track" cx="120" cy="120" r="${RING_R}" />
        <circle class="ring-fill" data-ring cx="120" cy="120" r="${RING_R}"
          stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 120 120)" />
      </svg>
      <div class="dial-center">
        <div class="dial-time" data-time role="timer" aria-live="off">25:00</div>
        <div class="dial-sub" data-sub></div>
      </div>
    </div>

    <div class="focus-setup" data-setup>
      <div class="mode-picker" role="radiogroup" aria-label="Timer">
        ${PRESET_MINUTES.map(
          (m) => `<button type="button" role="radio" aria-checked="false" data-choice="${m}"
                    aria-label="${m} minutes">${m}<small>min</small></button>`,
        ).join('')}
        <button type="button" role="radio" aria-checked="false" data-choice="stopwatch"
          aria-label="Free stopwatch">Free<small>stopwatch</small></button>
      </div>

      <section class="card tag-picker" aria-labelledby="tag-title">
        <h2 id="tag-title">What are you focusing on?</h2>
        <div class="tag-chips" role="radiogroup" aria-labelledby="tag-title" data-tags></div>
        <form class="new-label" data-new-label>
          <label class="visually-hidden" for="new-label">New label</label>
          <input id="new-label" name="label" maxlength="${LABEL_MAX_LENGTH}" placeholder="Quick label, e.g. Reading"
            autocomplete="off" enterkeyhint="done" />
          <button type="submit" class="step">Add</button>
        </form>
      </section>

      <button type="button" class="primary focus-start" data-action="start">Start</button>
    </div>

    <div class="focus-controls" data-running hidden>
      <button type="button" class="primary focus-big" data-action="toggle">Pause</button>
      <div class="focus-row">
        <button type="button" class="secondary" data-action="finish">Finish</button>
        <button type="button" class="secondary cancel" data-action="cancel">Cancel</button>
      </div>
    </div>

    <div class="focus-controls" data-finished hidden>
      <p class="focus-done" data-done-text></p>
      <div class="focus-row">
        <button type="button" class="secondary" data-action="extend">+5 min</button>
        <button type="button" class="primary" data-action="dismiss">Done</button>
      </div>
    </div>

    <p class="save-status" aria-live="polite" data-status></p>
    <p class="focus-today" data-today></p>
  `;

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const dial = $('[data-dial]');
  const ring = el.querySelector<SVGCircleElement>('[data-ring]')!;
  const timeEl = $('[data-time]');
  const subEl = $('[data-sub]');
  const setupEl = $('[data-setup]');
  const runningEl = $('[data-running]');
  const finishedEl = $('[data-finished]');
  const toggleBtn = $<HTMLButtonElement>('[data-action="toggle"]');
  const cancelBtn = $<HTMLButtonElement>('[data-action="cancel"]');
  const finishBtn = $<HTMLButtonElement>('[data-action="finish"]');
  const extendBtn = $<HTMLButtonElement>('[data-action="extend"]');
  const doneText = $('[data-done-text]');
  const tagsEl = $('[data-tags]');
  const newLabelForm = $<HTMLFormElement>('[data-new-label]');
  const statusEl = $('[data-status]');
  const todayEl = $('[data-today]');

  const prefs = timer.getPrefs();
  let choice: Choice = prefs.mode === 'stopwatch' ? { mode: 'stopwatch' } : { mode: 'countdown', minutes: prefs.minutes };
  if (choice.mode === 'countdown' && !(PRESET_MINUTES as readonly number[]).includes(choice.minutes)) {
    choice = { mode: 'countdown', minutes: PRESET_MINUTES[0] };
  }
  let tag: FocusTag = prefs.tag;
  /** Active projects can be picked; all are kept to name older sessions. */
  let projects: Project[] = [];
  let allProjects: Project[] = [];
  let projectsLoaded = false;
  let labels = timer.getRecentLabels();
  let tickTimer: number | undefined;
  let cancelTimer: number | undefined;
  let destroyed = false;
  const originalTitle = document.title;

  // ---- Tags ----

  function tagName(t: FocusTag): string | null {
    if (t.projectId) return allProjects.find((p) => p.id === t.projectId)?.name ?? 'Project';
    return t.label;
  }

  /** Keeps the remembered tag only if it can still be picked. */
  function validateTag(): void {
    if (projectsLoaded && tag.projectId && !projects.some((p) => p.id === tag.projectId)) tag = NO_TAG;
    if (tag.label && !labels.includes(tag.label)) tag = NO_TAG;
  }

  function renderTags(): void {
    const chip = (t: FocusTag, text: string, extra = '') => {
      const checked = sameTag(t, tag);
      return `<button type="button" role="radio" class="tag-chip" aria-checked="${checked}" tabindex="${checked ? 0 : -1}"
        data-project="${escapeHtml(t.projectId ?? '')}" data-label="${escapeHtml(t.label ?? '')}">${extra}${escapeHtml(text)}</button>`;
    };
    tagsEl.innerHTML = [
      ...projects.map((p) =>
        chip({ projectId: p.id, label: null }, p.name, `<span class="tag-dot" style="background:${escapeHtml(p.color)}"></span>`),
      ),
      ...labels.map((l) => chip({ projectId: null, label: l }, l)),
      chip(NO_TAG, 'No tag'),
    ].join('');
    if (!tagsEl.querySelector('[tabindex="0"]')) tagsEl.querySelector<HTMLElement>('.tag-chip')?.setAttribute('tabindex', '0');
  }

  function tagFromChip(chipEl: HTMLElement): FocusTag {
    return { projectId: chipEl.dataset.project || null, label: chipEl.dataset.label || null };
  }

  // ---- Rendering ----

  function renderChoice(): void {
    el.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => {
      const value = b.dataset.choice!;
      const checked = choice.mode === 'stopwatch' ? value === 'stopwatch' : value === String(choice.minutes);
      b.setAttribute('aria-checked', String(checked));
      b.tabIndex = checked ? 0 : -1;
    });
  }

  function renderStatus(): void {
    const s = timer.getSaveStatus();
    const text =
      s.kind === 'error'
        ? 'Couldn’t save this session on this device. It will be retried.'
        : s.kind === 'too-short'
          ? 'Under a minute, so nothing was saved.'
          : '';
    statusEl.textContent = text;
    statusEl.classList.toggle('error', s.kind === 'error');
    statusEl.classList.toggle('visible', !!text);
  }

  /** Updates the clock and ring; runs on every tick. */
  function renderClock(): void {
    const s = timer.getTimer();
    const now = Date.now();
    let fraction: number;
    if (!s) {
      timeEl.textContent = choice.mode === 'stopwatch' ? '0:00' : formatClock(choice.minutes * 60_000);
      fraction = 0;
    } else if (s.status === 'finished') {
      timeEl.textContent = formatClock(s.accumulatedMs);
      fraction = 1;
    } else if (s.mode === 'countdown') {
      timeEl.textContent = formatClock(remainingMs(s, now)!, 'up');
      fraction = progress(s, now);
    } else {
      timeEl.textContent = formatClock(elapsedMs(s, now));
      fraction = progress(s, now);
    }
    ring.style.strokeDashoffset = String(RING_C * (1 - fraction));
    document.title = s && s.status !== 'finished' ? `${timeEl.textContent} · Focus · Lifeboard` : originalTitle;
  }

  function subText(s: TimerState | null): string {
    if (!s) return choice.mode === 'stopwatch' ? 'Free stopwatch' : 'Ready when you are';
    const name = tagName(s.tag);
    const parts: string[] = [];
    if (s.status === 'paused') parts.push('Paused');
    else if (s.status === 'finished') parts.push('Focused');
    else parts.push(s.mode === 'stopwatch' ? 'Stopwatch' : 'Remaining');
    if (name) parts.push(name);
    return parts.join(' · ');
  }

  /** Shows the right panel for the timer's state. */
  function render(): void {
    const s = timer.getTimer();
    setupEl.hidden = !!s;
    runningEl.hidden = !s || s.status === 'finished';
    finishedEl.hidden = s?.status !== 'finished';
    dial.classList.toggle('is-running', s?.status === 'running');
    dial.classList.toggle('is-paused', s?.status === 'paused');
    dial.classList.toggle('is-finished', s?.status === 'finished');
    subEl.textContent = subText(s);

    if (s && s.status !== 'finished') {
      toggleBtn.textContent = s.status === 'paused' ? 'Resume' : 'Pause';
      // During an extension, Cancel drops only the extra time.
      if (!cancelBtn.classList.contains('armed')) cancelBtn.textContent = s.saved ? 'Undo +5' : 'Cancel';
      finishBtn.textContent = s.mode === 'countdown' && !s.saved ? 'End early' : 'Finish';
    }
    if (s?.status === 'finished') {
      const saved = timer.getSaveStatus().kind === 'saved' || !!s.saved;
      const minutes = Math.round(s.accumulatedMs / 60_000);
      doneText.textContent = saved
        ? `Nice work. ${formatDuration(minutes)} saved${s.date === todayKey() ? ' to today' : ''}.`
        : `${formatDuration(minutes)} of focus.`;
      extendBtn.hidden = s.mode !== 'countdown';
    }
    renderChoice();
    renderStatus();
    renderClock();

    window.clearInterval(tickTimer);
    if (s && s.status === 'running') tickTimer = window.setInterval(onTick, TICK_MS);
  }

  function onTick(): void {
    if (document.visibilityState !== 'visible') return;
    timer.tick(); // finishes the countdown on time even if its timeout was throttled
    renderClock();
  }

  async function loadToday(): Promise<void> {
    const date: DateKey = todayKey();
    try {
      const day = await getDay(date);
      if (destroyed) return;
      const sessions = day?.focusSessions ?? [];
      const total = totalFocusMinutes(sessions);
      todayEl.textContent =
        sessions.length === 0
          ? 'No focus sessions yet today.'
          : `Today: ${formatDuration(total)} across ${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    } catch {
      todayEl.textContent = '';
    }
  }

  // ---- Events ----

  function disarmCancel(): void {
    window.clearTimeout(cancelTimer);
    cancelBtn.classList.remove('armed');
    const s = timer.getTimer();
    cancelBtn.textContent = s?.saved ? 'Undo +5' : 'Cancel';
  }

  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const choiceBtn = target.closest<HTMLButtonElement>('[data-choice]');
    if (choiceBtn) {
      const v = choiceBtn.dataset.choice!;
      choice = v === 'stopwatch' ? { mode: 'stopwatch' } : { mode: 'countdown', minutes: Number(v) };
      render();
      return;
    }

    const chip = target.closest<HTMLButtonElement>('.tag-chip');
    if (chip) {
      tag = tagFromChip(chip);
      renderTags();
      tagsEl.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      return;
    }

    const action = target.closest<HTMLButtonElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'start': {
        const mode: TimerMode = choice.mode;
        timer.start(mode, choice.mode === 'countdown' ? choice.minutes : 0, tag);
        labels = timer.getRecentLabels();
        renderTags();
        break;
      }
      case 'toggle':
        if (timer.getTimer()?.status === 'paused') timer.resume();
        else timer.pause();
        break;
      case 'finish':
        disarmCancel();
        timer.finish();
        break;
      case 'cancel':
        // Two taps, so a stray touch never throws away a session.
        if (!cancelBtn.classList.contains('armed')) {
          cancelBtn.classList.add('armed');
          cancelBtn.textContent = timer.getTimer()?.saved ? 'Tap to drop +5' : 'Tap again to discard';
          cancelTimer = window.setTimeout(disarmCancel, CANCEL_CONFIRM_MS);
          return;
        }
        disarmCancel();
        timer.cancel();
        break;
      case 'extend':
        timer.extend();
        break;
      case 'dismiss':
        timer.dismiss();
        break;
    }
  });

  // Arrow keys move between options in a radio group.
  el.addEventListener('keydown', (event) => {
    const radio = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!radio || !delta) return;
    const group = [...radio.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const next = group[(group.indexOf(radio) + delta + group.length) % group.length];
    event.preventDefault();
    next.click();
    next.focus();
  });

  newLabelForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = newLabelForm.querySelector<HTMLInputElement>('input')!;
    const label = normalizeLabel(input.value);
    if (!label) return;
    labels = timer.addRecentLabel(label);
    tag = { projectId: null, label: labels[0] };
    input.value = '';
    input.blur();
    renderTags();
  });

  const unsubscribe = timer.subscribe(() => {
    if (!destroyed) render();
  });
  const unsubscribeSaved = timer.onSessionSaved(() => void loadToday());
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      renderClock();
      void loadToday();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // ---- Load ----
  validateTag();
  renderTags();
  render();
  void loadToday();
  getProjects()
    .then((file) => {
      if (destroyed) return;
      allProjects = file.projects;
      projects = file.projects.filter((p) => p.status === 'active');
      projectsLoaded = true;
      validateTag();
      renderTags();
      render(); // the running session's project name may now be known
    })
    .catch((error: unknown) => console.error('Loading projects failed', error));

  return {
    el,
    destroy() {
      destroyed = true;
      window.clearInterval(tickTimer);
      window.clearTimeout(cancelTimer);
      unsubscribe();
      unsubscribeSaved();
      document.removeEventListener('visibilitychange', onVisible);
      document.title = originalTitle;
    },
  };
}
