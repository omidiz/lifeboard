import { getAllFocusSessions, getProjects, updateProjects } from '../data/db';
import type { Project, ProjectsFile, ProjectStatus } from '../logic/model';
import {
  addMilestone,
  changeProject,
  createProject,
  focusMinutesByProject,
  MILESTONE_MAX_LENGTH,
  milestoneProgress,
  PROJECT_COLORS,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_STATUSES,
  removeMilestone,
  removeProject,
  renameMilestone,
  sortProjects,
  toggleMilestone,
  updateProject,
  upsertProject,
} from '../logic/projects';
import { routeHash } from '../logic/routes';
import { formatDuration } from '../logic/sleep';
import { escapeHtml } from './html';
import type { View } from './view';

const TEXT_SAVE_DELAY_MS = 400;
const CONFIRM_MS = 3000;

const STATUS_LABELS: Record<ProjectStatus, string> = { active: 'Active', paused: 'Paused', done: 'Done' };
const TRASH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`;

/** Projects list (#/projects) or one project (#/projects/<id>). */
export function createProjectsView(projectId: string | null): View {
  const el = document.createElement('section');
  el.className = 'view projects';
  el.setAttribute('aria-busy', 'true');

  let file: ProjectsFile = { projects: [], weeklyGoals: [], updatedAt: new Date().toISOString() };
  let focus = new Map<string, number>();
  let writes: Promise<unknown> = Promise.resolve();
  let statusTimer: number | undefined;
  let destroyed = false;
  const textTimers = new Map<string, { timer: number; apply: () => void }>();
  const timeouts = new Set<number>();
  const nowIso = () => new Date().toISOString();

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

  /** Updates the screen's copy at once, then writes the same change to IndexedDB, in order. */
  function save(change: (f: ProjectsFile) => ProjectsFile): void {
    file = change(file);
    writes = writes
      .then(() => updateProjects(change))
      .then(
        () => showStatus('Saved'),
        (error: unknown) => {
          console.error('Saving projects failed', error);
          showStatus('Couldn’t save on this device. Your last change may be lost.', true);
        },
      );
  }

  const editProject = (id: string, change: (p: Project) => Project) =>
    save((f) => changeProject(f, id, change, nowIso()));

  /** Debounced text edits, keyed by field; flushed on blur, leaving the page, or hiding the app. */
  function debounceText(key: string, apply: () => void): void {
    window.clearTimeout(textTimers.get(key)?.timer);
    const timer = window.setTimeout(() => {
      textTimers.delete(key);
      apply();
    }, TEXT_SAVE_DELAY_MS);
    textTimers.set(key, { timer, apply });
  }

  function flushText(): void {
    const pending = [...textTimers.values()];
    textTimers.clear();
    pending.forEach(({ timer, apply }) => {
      window.clearTimeout(timer);
      apply();
    });
  }

  function dropText(key: string): void {
    window.clearTimeout(textTimers.get(key)?.timer);
    textTimers.delete(key);
  }

  /** Two taps to confirm a destructive button; returns true on the second tap. */
  function confirmTap(button: HTMLButtonElement, armedLabel: string, armedText?: string): boolean {
    if (button.classList.contains('armed')) return true;
    const label = button.getAttribute('aria-label');
    const html = button.innerHTML;
    button.classList.add('armed');
    button.setAttribute('aria-label', armedLabel);
    if (armedText) button.textContent = armedText;
    const t = window.setTimeout(() => {
      button.classList.remove('armed');
      if (label) button.setAttribute('aria-label', label);
      button.innerHTML = html;
      timeouts.delete(t);
    }, CONFIRM_MS);
    timeouts.add(t);
    return false;
  }

  // ---------- List ----------

  function renderList(): void {
    const projects = sortProjects(file.projects);
    el.innerHTML = `
      <header class="view-header"><h1>Projects</h1></header>
      <form class="card add-project" data-add-project>
        <label class="visually-hidden" for="new-project-name">New project name</label>
        <input id="new-project-name" class="name-input" name="name" maxlength="${PROJECT_NAME_MAX_LENGTH}"
          placeholder="New project" autocomplete="off" enterkeyhint="done" required />
        <button type="submit" class="primary">Add</button>
      </form>
      ${
        projects.length === 0
          ? `<p class="empty">No projects yet. Add one above, then tag focus sessions with it.</p>`
          : `<ul class="project-list">${projects.map(projectCard).join('')}</ul>`
      }
    `;
    el.append(status);
  }

  function projectCard(p: Project): string {
    const { done, total } = milestoneProgress(p);
    const minutes = focus.get(p.id) ?? 0;
    const meta = [`${formatDuration(minutes)} focused`];
    if (total > 0) meta.push(`${done}/${total} milestones`);
    return `
      <li>
        <a class="card project-card status-${p.status}" href="${routeHash('projects', p.id)}">
          <span class="project-dot" style="background:${p.color}" aria-hidden="true"></span>
          <span class="project-text">
            <span class="project-name">${escapeHtml(p.name)}</span>
            <span class="project-meta">${meta.join(' · ')}</span>
            ${total > 0 ? progressBar(done, total, p.color) : ''}
          </span>
          ${p.status === 'active' ? '' : `<span class="status-badge">${STATUS_LABELS[p.status]}</span>`}
        </a>
      </li>`;
  }

  // ---------- Detail ----------

  function renderDetail(id: string): void {
    const p = file.projects.find((x) => x.id === id);
    if (!p) {
      el.innerHTML = `
        ${backLink()}
        <p class="empty">This project doesn’t exist anymore. <a href="${routeHash('projects')}">See all projects</a>.</p>`;
      return;
    }
    el.innerHTML = `
      ${backLink()}
      <section class="card project-detail">
        <label class="visually-hidden" for="project-name">Project name</label>
        <input id="project-name" class="project-title-input" data-project-name value="${escapeHtml(p.name)}"
          maxlength="${PROJECT_NAME_MAX_LENGTH}" autocomplete="off" enterkeyhint="done" />
        <div class="project-stats">
          <div><span class="stat-value" data-focus-total></span><span class="stat-label">focused</span></div>
          <div><span class="stat-value" data-milestone-count></span><span class="stat-label">milestones</span></div>
        </div>
        <div data-progress></div>

        <h2 class="field-label" id="status-label">Status</h2>
        <div class="segmented" role="radiogroup" aria-labelledby="status-label">
          ${PROJECT_STATUSES.map(
            (s) => `<button type="button" role="radio" data-status="${s}" aria-checked="false">${STATUS_LABELS[s]}</button>`,
          ).join('')}
        </div>

        <h2 class="field-label" id="color-label">Color</h2>
        <div class="swatches" role="radiogroup" aria-labelledby="color-label">
          ${PROJECT_COLORS.map(
            (c, i) => `<button type="button" role="radio" class="swatch" data-color="${c}" aria-checked="false"
              aria-label="Color ${i + 1}" style="--swatch:${c}"></button>`,
          ).join('')}
        </div>
      </section>

      <section class="card" aria-labelledby="milestones-title">
        <h2 id="milestones-title">Milestones</h2>
        <ul class="milestones" data-milestones></ul>
        <form class="add-row" data-add-milestone>
          <label class="visually-hidden" for="new-milestone">New milestone</label>
          <input id="new-milestone" name="title" maxlength="${MILESTONE_MAX_LENGTH}" placeholder="Add a milestone"
            autocomplete="off" enterkeyhint="done" />
          <button type="submit" class="step">Add</button>
        </form>
      </section>

      <button type="button" class="secondary danger" data-delete-project aria-label="Delete project">Delete project</button>
    `;
    el.append(status);
    renderMilestones(p);
    updateDetail(p);
  }

  function backLink(): string {
    return `<header class="sub-header">
      <a class="icon-button" href="${routeHash('projects')}" aria-label="All projects">${BACK_ICON}</a>
      <span>Projects</span>
    </header>`;
  }

  function renderMilestones(p: Project): void {
    const list = el.querySelector<HTMLElement>('[data-milestones]')!;
    list.innerHTML =
      p.milestones.length === 0
        ? `<li class="empty">Break the project into a few checkable steps.</li>`
        : p.milestones
            .map(
              (m) => `
          <li class="milestone" data-milestone-id="${escapeHtml(m.id)}">
            <button type="button" class="check" data-toggle-milestone aria-pressed="${m.done}"
              aria-label="Done: ${escapeHtml(m.title)}">${CHECK_ICON}</button>
            <input class="milestone-title" data-milestone-title value="${escapeHtml(m.title)}"
              maxlength="${MILESTONE_MAX_LENGTH}" autocomplete="off" enterkeyhint="done" aria-label="Milestone" />
            <button type="button" class="icon-button delete" data-remove-milestone
              aria-label="Remove ${escapeHtml(m.title)}">${TRASH_ICON}<span class="delete-confirm">Remove?</span></button>
          </li>`,
            )
            .join('');
  }

  /** Refreshes stats and selected options without rebuilding inputs (keeps focus and typing). */
  function updateDetail(p: Project): void {
    const { done, total } = milestoneProgress(p);
    el.querySelector('[data-focus-total]')!.textContent = formatDuration(focus.get(p.id) ?? 0);
    el.querySelector('[data-milestone-count]')!.textContent = total ? `${done}/${total}` : '–';
    el.querySelector('[data-progress]')!.innerHTML = total ? progressBar(done, total, p.color) : '';
    el.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((b) => {
      const on = b.dataset.status === p.status;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    el.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => {
      const on = b.dataset.color === p.color;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    el.querySelectorAll<HTMLElement>('[data-milestone-id]').forEach((row) => {
      const m = p.milestones.find((x) => x.id === row.dataset.milestoneId);
      row.querySelector('[data-toggle-milestone]')!.setAttribute('aria-pressed', String(!!m?.done));
      row.classList.toggle('done', !!m?.done);
    });
  }

  const current = () => (projectId ? file.projects.find((p) => p.id === projectId) : undefined);

  // ---------- Events ----------

  el.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (form.matches('[data-add-project]')) {
      const name = String(new FormData(form).get('name') ?? '').trim();
      if (!name) return;
      // Pick the first color not used by an active project, so new projects look distinct.
      const used = new Set(file.projects.filter((p) => p.status !== 'done').map((p) => p.color));
      const color = PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[file.projects.length % PROJECT_COLORS.length];
      const project = createProject({ name, color }, crypto.randomUUID(), nowIso());
      save((f) => upsertProject(f, project, nowIso()));
      location.hash = routeHash('projects', project.id);
      return;
    }
    if (form.matches('[data-add-milestone]') && projectId) {
      const input = form.querySelector<HTMLInputElement>('input')!;
      const title = input.value.trim();
      if (!title) return;
      const id = crypto.randomUUID();
      editProject(projectId, (p) => addMilestone(p, title, id, nowIso()));
      input.value = '';
      const p = current();
      if (p) {
        renderMilestones(p);
        updateDetail(p);
      }
      input.focus();
    }
  });

  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const p = current();
    if (!p || !projectId) return;
    const id = projectId;

    const statusBtn = target.closest<HTMLButtonElement>('[data-status]');
    if (statusBtn) {
      editProject(id, (x) => updateProject(x, { status: statusBtn.dataset.status as ProjectStatus }, nowIso()));
      return updateDetail(current()!);
    }
    const colorBtn = target.closest<HTMLButtonElement>('[data-color]');
    if (colorBtn) {
      editProject(id, (x) => updateProject(x, { color: colorBtn.dataset.color }, nowIso()));
      return updateDetail(current()!);
    }
    const row = target.closest<HTMLElement>('[data-milestone-id]');
    if (row) {
      const mid = row.dataset.milestoneId!;
      if (target.closest('[data-toggle-milestone]')) {
        editProject(id, (x) => toggleMilestone(x, mid, nowIso()));
        return updateDetail(current()!);
      }
      const remove = target.closest<HTMLButtonElement>('[data-remove-milestone]');
      if (remove && confirmTap(remove, 'Tap again to remove')) {
        dropText(`m:${mid}`);
        editProject(id, (x) => removeMilestone(x, mid, nowIso()));
        renderMilestones(current()!);
        updateDetail(current()!);
      }
      return;
    }
    const del = target.closest<HTMLButtonElement>('[data-delete-project]');
    if (del) {
      if (!confirmTap(del, 'Tap again to delete', 'Tap again to delete')) return;
      textTimers.forEach(({ timer }) => window.clearTimeout(timer));
      textTimers.clear();
      save((f) => removeProject(f, id, nowIso()));
      location.hash = routeHash('projects');
    }
  });

  el.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!projectId) return;
    const id = projectId;
    if (input.matches('[data-project-name]')) {
      debounceText('name', () => {
        editProject(id, (x) => updateProject(x, { name: input.value }, nowIso()));
      });
    } else if (input.matches('[data-milestone-title]')) {
      const mid = input.closest<HTMLElement>('[data-milestone-id]')!.dataset.milestoneId!;
      debounceText(`m:${mid}`, () => editProject(id, (x) => renameMilestone(x, mid, input.value, nowIso())));
    }
  });

  // On leaving a field, save it and show the cleaned-up value.
  el.addEventListener('focusout', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-project-name], [data-milestone-title]')) return;
    flushText();
    const p = current();
    if (!p) return;
    if (input.matches('[data-project-name]')) input.value = p.name;
    else {
      const mid = input.closest<HTMLElement>('[data-milestone-id]')!.dataset.milestoneId;
      const m = p.milestones.find((x) => x.id === mid);
      if (m) input.value = m.title;
    }
  });

  el.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target.matches('[data-project-name], [data-milestone-title]')) {
      (target as HTMLInputElement).blur();
      return;
    }
    // Arrow keys move within a radio group.
    const radio = target.closest<HTMLButtonElement>('[role="radio"]');
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!radio || !delta) return;
    const group = [...radio.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const next = group[(group.indexOf(radio) + delta + group.length) % group.length];
    event.preventDefault();
    next.click();
    next.focus();
  });

  const onHide = () => {
    if (document.visibilityState === 'hidden') flushText();
  };
  document.addEventListener('visibilitychange', onHide);

  // ---------- Load ----------

  Promise.all([getProjects(), getAllFocusSessions()])
    .then(([stored, sessions]) => {
      if (destroyed) return;
      file = stored;
      focus = focusMinutesByProject(sessions);
    })
    .catch((error: unknown) => {
      console.error('Loading projects failed', error);
      if (!destroyed) showStatus('Couldn’t open local storage. Changes won’t be kept.', true);
    })
    .finally(() => {
      if (destroyed) return;
      if (projectId) renderDetail(projectId);
      else renderList();
      el.removeAttribute('aria-busy');
    });

  return {
    el,
    destroy() {
      flushText();
      destroyed = true;
      window.clearTimeout(statusTimer);
      timeouts.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('visibilitychange', onHide);
    },
  };
}

function progressBar(done: number, total: number, color: string): string {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"
    aria-label="${done} of ${total} milestones done"><span style="width:${pct}%;background:${color}"></span></span>`;
}
