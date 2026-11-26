import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  isTimeOfDay,
  minutesToTime,
  shiftTime,
  sleepDurationMinutes,
  timeToMinutes,
} from './sleep';

describe('time conversion', () => {
  it('converts both ways', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('07:45')).toBe(465);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(minutesToTime(465)).toBe('07:45');
  });

  it('wraps minutes outside a single day', () => {
    expect(minutesToTime(1440)).toBe('00:00');
    expect(minutesToTime(1500)).toBe('01:00');
    expect(minutesToTime(-15)).toBe('23:45');
  });

  it('validates times', () => {
    expect(isTimeOfDay('23:30')).toBe(true);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('7:30')).toBe(false);
    expect(() => timeToMinutes('12:60')).toThrow();
  });
});

describe('shiftTime', () => {
  it('moves by 15 minutes', () => {
    expect(shiftTime('23:00', 15)).toBe('23:15');
    expect(shiftTime('23:00', -15)).toBe('22:45');
  });

  it('wraps across midnight', () => {
    expect(shiftTime('23:45', 15)).toBe('00:00');
    expect(shiftTime('00:00', -15)).toBe('23:45');
  });

  it('snaps off-grid times onto the 15-minute grid', () => {
    expect(shiftTime('23:07', 15)).toBe('23:15');
    expect(shiftTime('23:07', -15)).toBe('23:00');
    expect(shiftTime('23:52', 15)).toBe('00:00');
  });
});

describe('sleepDurationMinutes', () => {
  it('handles sleep that crosses midnight', () => {
    expect(sleepDurationMinutes('23:00', '07:00')).toBe(8 * 60);
    expect(sleepDurationMinutes('22:15', '06:30')).toBe(8 * 60 + 15);
    expect(sleepDurationMinutes('23:45', '00:15')).toBe(30);
  });

  it('handles a bedtime after midnight', () => {
    expect(sleepDurationMinutes('00:30', '08:00')).toBe(7 * 60 + 30);
    expect(sleepDurationMinutes('02:00', '10:15')).toBe(8 * 60 + 15);
  });

  it('handles a nap within the same day', () => {
    expect(sleepDurationMinutes('13:00', '14:30')).toBe(90);
  });

  it('handles bedtime exactly at midnight', () => {
    expect(sleepDurationMinutes('00:00', '07:00')).toBe(7 * 60);
    expect(sleepDurationMinutes('22:00', '00:00')).toBe(2 * 60);
  });

  it('treats equal times as no sleep', () => {
    expect(sleepDurationMinutes('07:00', '07:00')).toBe(0);
  });

  it('never exceeds a day', () => {
    expect(sleepDurationMinutes('07:15', '07:00')).toBe(1425);
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(465)).toBe('7h 45m');
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(0)).toBe('0m');
  });
});
