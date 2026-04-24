/**
 * Work Schedule Manager
 *
 * Controls when agents are allowed to poll and work.
 * Supports a daily time window and optional day-of-week restrictions.
 *
 * Configuration (env vars):
 *   WORK_SCHEDULE_START=08:00          (start of work window, 24h format, default: always on)
 *   WORK_SCHEDULE_END=22:00            (end of work window, 24h format)
 *   WORK_SCHEDULE_DAYS=mon,tue,wed,thu,fri   (allowed days, default: all days)
 *   WORK_SCHEDULE_TIMEZONE=Africa/Johannesburg  (timezone for schedule, default: system local)
 */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface ScheduleConfig {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  allowedDays: Set<number>; // 0=Sun, 1=Mon, ..., 6=Sat
  timezone: string | undefined;
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: "${timeStr}". Use HH:MM (24h format).`);
  }
  return { hour: h, minute: m };
}

function parseDays(daysStr: string): Set<number> {
  const days = new Set<number>();
  for (const d of daysStr.split(",")) {
    const trimmed = d.trim().toLowerCase();
    const idx = DAY_NAMES.indexOf(trimmed as any);
    if (idx === -1) {
      throw new Error(`Invalid day: "${trimmed}". Use: ${DAY_NAMES.join(", ")}`);
    }
    days.add(idx);
  }
  return days;
}

function loadConfig(): ScheduleConfig {
  const startStr = process.env.WORK_SCHEDULE_START;
  const endStr = process.env.WORK_SCHEDULE_END;

  if (!startStr && !endStr) {
    return {
      enabled: false,
      startHour: 0, startMinute: 0,
      endHour: 23, endMinute: 59,
      allowedDays: new Set([0, 1, 2, 3, 4, 5, 6]),
      timezone: undefined,
    };
  }

  if (!startStr || !endStr) {
    throw new Error("Both WORK_SCHEDULE_START and WORK_SCHEDULE_END must be set (or neither).");
  }

  const start = parseTime(startStr);
  const end = parseTime(endStr);

  const daysStr = process.env.WORK_SCHEDULE_DAYS;
  const allowedDays = daysStr
    ? parseDays(daysStr)
    : new Set([0, 1, 2, 3, 4, 5, 6]);

  const timezone = process.env.WORK_SCHEDULE_TIMEZONE || undefined;

  return {
    enabled: true,
    startHour: start.hour,
    startMinute: start.minute,
    endHour: end.hour,
    endMinute: end.minute,
    allowedDays,
    timezone,
  };
}

const config = loadConfig();

/**
 * Get current time in the configured timezone.
 */
function getNow(): { hour: number; minute: number; day: number } {
  const now = new Date();
  if (config.timezone) {
    // Use Intl to get time in the target timezone
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);

    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
    const day = DAY_NAMES.indexOf(weekday.slice(0, 3) as any);
    return { hour, minute, day: day >= 0 ? day : now.getDay() };
  }

  return { hour: now.getHours(), minute: now.getMinutes(), day: now.getDay() };
}

/**
 * Check if we're currently within the work schedule window.
 */
export function isWithinSchedule(): boolean {
  if (!config.enabled) return true;

  const { hour, minute, day } = getNow();

  // Check day of week
  if (!config.allowedDays.has(day)) return false;

  // Check time window
  const nowMinutes = hour * 60 + minute;
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;

  // Handle overnight windows (e.g. 22:00 - 06:00)
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

/**
 * Get a human-readable description of the schedule.
 */
export function getScheduleDescription(): string {
  if (!config.enabled) return "No schedule — agents run 24/7";

  const start = `${String(config.startHour).padStart(2, "0")}:${String(config.startMinute).padStart(2, "0")}`;
  const end = `${String(config.endHour).padStart(2, "0")}:${String(config.endMinute).padStart(2, "0")}`;
  const days = [...config.allowedDays]
    .sort()
    .map((d) => DAY_NAMES[d])
    .join(", ");
  const tz = config.timezone ?? "local";

  return `Work window: ${start}–${end} (${tz}), days: ${days}`;
}

/**
 * Get time until next work window opens (in ms). Returns 0 if currently in window.
 */
export function msUntilNextWindow(): number {
  if (!config.enabled || isWithinSchedule()) return 0;

  // Simple approach: check each minute for the next 7 days
  const now = new Date();
  for (let offsetMin = 1; offsetMin <= 7 * 24 * 60; offsetMin++) {
    const future = new Date(now.getTime() + offsetMin * 60_000);

    // Temporarily check if that future time would be in-window
    // We do this by checking against the config directly
    let hour: number, minute: number, day: number;
    if (config.timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
        hour12: false,
      }).formatToParts(future);
      hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
      day = DAY_NAMES.indexOf(weekday.slice(0, 3) as any);
      if (day < 0) day = future.getDay();
    } else {
      hour = future.getHours();
      minute = future.getMinutes();
      day = future.getDay();
    }

    if (!config.allowedDays.has(day)) continue;

    const futureMinutes = hour * 60 + minute;
    const startMinutes = config.startHour * 60 + config.startMinute;
    const endMinutes = config.endHour * 60 + config.endMinute;

    let inWindow: boolean;
    if (startMinutes <= endMinutes) {
      inWindow = futureMinutes >= startMinutes && futureMinutes < endMinutes;
    } else {
      inWindow = futureMinutes >= startMinutes || futureMinutes < endMinutes;
    }

    if (inWindow) return offsetMin * 60_000;
  }

  return 24 * 60 * 60_000; // fallback: 1 day
}
