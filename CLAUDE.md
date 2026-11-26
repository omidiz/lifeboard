# Lifeboard — my personal life dashboard

## Concept
A personal dashboard for one user (me) to track sleep & energy, focus &
study, habits, and projects & goals. I use it daily on both laptop and
phone. It combines clear stats (charts, trends, weekly review) with a
"living" view: a generative garden that grows from my data.

## Features
- Today: morning check-in (bedtime, wake time, sleep quality 1–5,
  energy 1–5, mood 1–5), one-line note, today's focus total, this week's
  goals, habit toggles; can go back to fill in past days
- Habits: create/edit/delete (name, emoji, target days per week),
  one-tap tick, weekly-target-based streaks, weekly progress (e.g. 3/5)
- Focus: timer with 25/50/90 min presets and a free stopwatch mode,
  tag or project picked before starting, auto-logged when finished,
  correct even when the screen is locked, sound/vibration at the end,
  +5 min extension
- Projects & goals: projects with name, color, status
  (active/paused/done) and checkable milestones; up to 3 weekly goals;
  total focus time per project
- Stats: week/month/3-month ranges; sleep duration and bedtime
  consistency; energy and mood trends; focus hours by project; habit
  heatmap; honest "patterns" from my own data
- Garden: a generative garden driven by my data (focus grows plants,
  habits add flowers, sleep regularity sets the air clarity, energy/mood
  sets the light); weekly snapshots; export as wallpaper
- Weekly review: summary card plus "What will you focus on next week?"
- Settings: GitHub sync setup, sync status, disconnect, JSON export/import
- App: installable PWA, works fully offline, bottom navigation:
  Today, Focus, Stats, Garden, Settings

## Tech stack
- Vite + vanilla TypeScript, no UI framework
- Deployed on GitHub Pages at https://omidiz.github.io/lifeboard/
- Local storage: IndexedDB, offline-first (every change saves locally
  first, then syncs)
- Sync: a PRIVATE GitHub repo "lifeboard-data" via the GitHub REST API,
  using a fine-grained token the user enters in Settings
- Vitest for tests

## Data model (JSON files in lifeboard-data)
- days/YYYY-MM-DD.json: check-in, habit ticks, focus sessions, note
- habits.json: habit definitions
- projects.json: projects, milestones, and weekly goals
One file per day keeps sync conflicts small. On conflict, merge at the
field level (union of habit ticks and focus sessions; latest check-in
values win); never blindly overwrite.

## UX principles
- Daily logging must take under 30 seconds in total
- Every daily action reachable within 2 taps
- Instant save, no "Save" buttons
- Smart defaults (e.g. bedtime prefilled from yesterday, adjust with
  +/- 15 min)
- Mobile-first
- Streaks follow weekly targets, so a rest day never breaks them
- The garden never punishes: no wilting or dying; the worst state is a
  soft mist. It should feel encouraging, never guilt-inducing
- Patterns are honest: only shown with enough data, always with the
  number of days behind them
- Maximum 3 weekly goals

## Rules
- The token must never appear in code, URLs, logs, error messages, or
  committed files, and must only be sent to api.github.com
- Pure logic (dates, streaks, stats, sync merge) lives in src/logic/
  with unit tests
- Ask me before adding any dependency (including chart libraries)
- Commit after each completed step with a clear message
