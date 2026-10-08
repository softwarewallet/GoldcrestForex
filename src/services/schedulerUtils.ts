export interface RiskWindowItem {
  id: string;
  name: string;
  enabled: boolean;
  startTime: string; // "HH:mm", e.g. "22:00" (10:00 PM)
  endTime: string;   // "HH:mm", e.g. "05:00" (05:00 AM)
}

export interface AutoLiveSchedulerConfig {
  enabled: boolean;
  timezone: 'LOCAL' | 'UTC';
  windows: RiskWindowItem[];
  // Legacy backward compatibility fields
  startTime?: string;
  endTime?: string;
}

export interface ActiveRiskWindowSummary {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  startTime12: string;
  endTime12: string;
  minutesRemaining: number;
  formattedRemaining: string;
}

export interface UpcomingRiskWindowSummary {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  startTime12: string;
  endTime12: string;
  minutesUntilStart: number;
  formattedUntilStart: string;
}

export interface EvaluatedWindowItem extends RiskWindowItem {
  startTime12: string;
  endTime12: string;
  isActiveNow: boolean;
  durationMinutes: number;
  durationFormatted: string;
  spansMidnight: boolean;
}

export interface SchedulerEvaluationResult {
  enabled: boolean;
  inRiskWindow: boolean;
  windows: EvaluatedWindowItem[];
  activeWindow: ActiveRiskWindowSummary | null;
  activeWindows: ActiveRiskWindowSummary[];
  nextUpcomingWindow: UpcomingRiskWindowSummary | null;
  timezone: 'LOCAL' | 'UTC';
  currentTime24: string;
  currentTime12: string;
  nextTransitionType: 'PAUSE' | 'RESUME';
  minutesUntilNextTransition: number;
  timeUntilNextTransitionFormatted: string;
  nextTransitionTime12: string;
  totalConfiguredWindows: number;
  activeConfiguredWindowsCount: number;
  summary: string;
  message: string;
  // Legacy fields for backward compatibility
  startTime: string;
  endTime: string;
  startTime12: string;
  endTime12: string;
}

/**
 * Parses "HH:mm" string to total minutes since midnight (0..1439).
 * Returns -1 if invalid format.
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || typeof timeStr !== 'string') return -1;
  const match = timeStr.trim().match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (!match) return -1;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
}

/**
 * Formats total minutes since midnight to 12-hour AM/PM string (e.g. 1320 -> "10:00 PM")
 */
export function formatMinutesTo12Hour(totalMinutes: number): string {
  const norm = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(norm / 60);
  const minutes = norm % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const padMin = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours12}:${padMin} ${period}`;
}

/**
 * Formats total minutes to 24-hour "HH:mm" format.
 */
export function formatMinutesTo24Hour(totalMinutes: number): string {
  const norm = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(norm / 60);
  const minutes = norm % 60;
  const padHours = hours < 10 ? `0${hours}` : `${hours}`;
  const padMin = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${padHours}:${padMin}`;
}

/**
 * Formats duration in minutes to human-readable string (e.g. "4h 25m", "15m").
 */
export function formatDurationMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(m / 60);
  const remMinutes = m % 60;
  if (hours === 0) return `${remMinutes}m`;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
}

/**
 * Checks whether current time (in minutes) falls within the window defined by start & end minutes.
 * Correctly handles overnight windows spanning midnight (e.g. 22:00 to 05:00 / 10:00 PM to 5:00 AM).
 */
export function isTimeInWindow(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) {
    // Zero-length window: never active
    return false;
  }
  if (startMinutes < endMinutes) {
    // Intra-day window (e.g. 13:00 to 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window spanning midnight (e.g. 22:00 to 05:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Calculates duration of a window in minutes.
 */
export function getWindowDurationMinutes(startMinutes: number, endMinutes: number): number {
  if (startMinutes === endMinutes) return 0;
  if (startMinutes < endMinutes) {
    return endMinutes - startMinutes;
  } else {
    return (1440 - startMinutes) + endMinutes;
  }
}

/**
 * Returns minute delta from currentMinutes forward to targetMinutes (0..1439).
 */
export function getMinutesForwardTo(currentMinutes: number, targetMinutes: number): number {
  const diff = targetMinutes - currentMinutes;
  if (diff >= 0) return diff;
  return 1440 + diff;
}

export const DEFAULT_RISK_WINDOWS: RiskWindowItem[] = [
  {
    id: 'w-overnight',
    name: 'Asian Rollover / Overnight Low Liquidity',
    enabled: true,
    startTime: '22:00',
    endTime: '05:00'
  }
];

/**
 * Normalizes scheduler configuration, migrating legacy single-window configurations if present.
 */
export function normalizeSchedulerConfig(config?: Partial<AutoLiveSchedulerConfig | SchedulerEvaluationResult>): AutoLiveSchedulerConfig {
  const timezone = config?.timezone === 'UTC' ? 'UTC' : 'LOCAL';
  const enabled = Boolean(config?.enabled);

  let windows: RiskWindowItem[] = [];

  if (Array.isArray(config?.windows) && config.windows.length > 0) {
    windows = config.windows.map((w, idx) => {
      const id = typeof w.id === 'string' && w.id.trim() ? w.id.trim() : `window-${idx + 1}`;
      const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : `Risk Window ${idx + 1}`;
      const itemEnabled = typeof w.enabled === 'boolean' ? w.enabled : true;
      const startTime = typeof w.startTime === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(w.startTime)
        ? w.startTime.trim()
        : '22:00';
      const endTime = typeof w.endTime === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(w.endTime)
        ? w.endTime.trim()
        : '05:00';
      return { id, name, enabled: itemEnabled, startTime, endTime };
    });
  } else if (config?.startTime || config?.endTime) {
    const startTime = typeof config.startTime === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(config.startTime)
      ? config.startTime.trim()
      : '22:00';
    const endTime = typeof config.endTime === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(config.endTime)
      ? config.endTime.trim()
      : '05:00';
    windows = [
      {
        id: 'w-legacy',
        name: 'Primary Risk Blackout Window',
        enabled: true,
        startTime,
        endTime
      }
    ];
  } else {
    windows = [...DEFAULT_RISK_WINDOWS];
  }

  const primaryWindow = windows[0] || DEFAULT_RISK_WINDOWS[0];

  return {
    enabled,
    timezone,
    windows,
    startTime: primaryWindow.startTime,
    endTime: primaryWindow.endTime
  };
}

/**
 * Full multi-window evaluation of Auto Live Scheduler for runtime decisions and UI display.
 */
export function evaluateAutoLiveScheduler(
  config?: AutoLiveSchedulerConfig,
  referenceDate = new Date()
): SchedulerEvaluationResult {
  const normalized = normalizeSchedulerConfig(config);
  const { enabled, timezone, windows } = normalized;

  const currentMinutes = timezone === 'UTC'
    ? referenceDate.getUTCHours() * 60 + referenceDate.getUTCMinutes()
    : referenceDate.getHours() * 60 + referenceDate.getMinutes();

  const currentTime24 = formatMinutesTo24Hour(currentMinutes);
  const currentTime12 = formatMinutesTo12Hour(currentMinutes);

  // Evaluate each configured window
  const evaluatedWindows: EvaluatedWindowItem[] = windows.map(w => {
    const sMin = parseTimeToMinutes(w.startTime);
    const eMin = parseTimeToMinutes(w.endTime);
    const valid = sMin >= 0 && eMin >= 0;
    const s12 = valid ? formatMinutesTo12Hour(sMin) : '--:--';
    const e12 = valid ? formatMinutesTo12Hour(eMin) : '--:--';
    const duration = valid ? getWindowDurationMinutes(sMin, eMin) : 0;
    const spansMidnight = valid && sMin > eMin;
    const isActive = valid && w.enabled && isTimeInWindow(currentMinutes, sMin, eMin);

    return {
      ...w,
      startTime12: s12,
      endTime12: e12,
      isActiveNow: isActive,
      durationMinutes: duration,
      durationFormatted: formatDurationMinutes(duration),
      spansMidnight
    };
  });

  const enabledEvaluatedWindows = evaluatedWindows.filter(w => w.enabled);
  const activeEvaluatedWindows = enabledEvaluatedWindows.filter(w => w.isActiveNow);
  const inRiskWindow = enabled && activeEvaluatedWindows.length > 0;

  const firstWindow = evaluatedWindows[0] || {
    startTime: '22:00',
    endTime: '05:00',
    startTime12: '10:00 PM',
    endTime12: '5:00 AM'
  };

  // If scheduler is disabled or no enabled windows exist:
  if (!enabled || enabledEvaluatedWindows.length === 0) {
    return {
      enabled: false,
      inRiskWindow: false,
      windows: evaluatedWindows,
      activeWindow: null,
      activeWindows: [],
      nextUpcomingWindow: null,
      timezone,
      currentTime24,
      currentTime12,
      nextTransitionType: 'PAUSE',
      minutesUntilNextTransition: 0,
      timeUntilNextTransitionFormatted: '',
      nextTransitionTime12: firstWindow.startTime12,
      totalConfiguredWindows: evaluatedWindows.length,
      activeConfiguredWindowsCount: 0,
      summary: !enabled
        ? 'Scheduler disabled: Auto Live operates continuously when armed.'
        : 'Scheduler enabled, but all risk blackout windows are currently toggled off.',
      message: !enabled
        ? 'Risk window scheduler is disabled.'
        : 'No risk windows are currently active or enabled.',
      startTime: firstWindow.startTime,
      endTime: firstWindow.endTime,
      startTime12: firstWindow.startTime12,
      endTime12: firstWindow.endTime12
    };
  }

  // Active risk summaries
  const activeSummaries: ActiveRiskWindowSummary[] = activeEvaluatedWindows.map(w => {
    const eMin = parseTimeToMinutes(w.endTime);
    const minsRem = getMinutesForwardTo(currentMinutes, eMin);
    return {
      id: w.id,
      name: w.name,
      startTime: w.startTime,
      endTime: w.endTime,
      startTime12: w.startTime12,
      endTime12: w.endTime12,
      minutesRemaining: Math.max(1, minsRem),
      formattedRemaining: formatDurationMinutes(Math.max(1, minsRem))
    };
  });

  if (inRiskWindow) {
    // Currently inside at least one risk window!
    // Determine exact minutes until the blackout period ends.
    // We trace minute-by-minute to handle overlapping or contiguous windows.
    let minutesUntilResume = 0;
    while (minutesUntilResume < 1440) {
      const checkMin = (currentMinutes + minutesUntilResume) % 1440;
      const isCovered = enabledEvaluatedWindows.some(w => {
        const sMin = parseTimeToMinutes(w.startTime);
        const eMin = parseTimeToMinutes(w.endTime);
        return isTimeInWindow(checkMin, sMin, eMin);
      });
      if (!isCovered) break;
      minutesUntilResume++;
    }

    if (minutesUntilResume === 0) minutesUntilResume = 1;

    const resumeTimeMinutes = (currentMinutes + minutesUntilResume) % 1440;
    const resumeTime12 = formatMinutesTo12Hour(resumeTimeMinutes);
    const durationFormatted = formatDurationMinutes(minutesUntilResume);

    const primaryActive = activeSummaries[0];
    const windowNames = activeSummaries.map(w => w.name).join(', ');
    const windowTimes = activeSummaries.map(w => `${w.startTime12}–${w.endTime12}`).join(', ');

    const message = `Auto Live paused: Inside Risk Blackout Window [${windowNames}] (${windowTimes} ${timezone}). Order evaluation paused to prevent high-loss hours. System will automatically resume in ${durationFormatted} (at ${resumeTime12}).`;

    return {
      enabled: true,
      inRiskWindow: true,
      windows: evaluatedWindows,
      activeWindow: primaryActive || null,
      activeWindows: activeSummaries,
      nextUpcomingWindow: null,
      timezone,
      currentTime24,
      currentTime12,
      nextTransitionType: 'RESUME',
      minutesUntilNextTransition: minutesUntilResume,
      timeUntilNextTransitionFormatted: durationFormatted,
      nextTransitionTime12: resumeTime12,
      totalConfiguredWindows: evaluatedWindows.length,
      activeConfiguredWindowsCount: enabledEvaluatedWindows.length,
      summary: `PAUSED (RISK WINDOW) — Auto-resumes in ${durationFormatted} at ${resumeTime12}`,
      message,
      startTime: primaryActive?.startTime || firstWindow.startTime,
      endTime: primaryActive?.endTime || firstWindow.endTime,
      startTime12: primaryActive?.startTime12 || firstWindow.startTime12,
      endTime12: primaryActive?.endTime12 || firstWindow.endTime12
    };
  } else {
    // Outside risk windows -> find the next window that will start
    let minutesUntilPause = 0;
    let triggeringWindow: EvaluatedWindowItem | null = null;

    while (minutesUntilPause < 1440) {
      const checkMin = (currentMinutes + minutesUntilPause) % 1440;
      const covering = enabledEvaluatedWindows.find(w => {
        const sMin = parseTimeToMinutes(w.startTime);
        const eMin = parseTimeToMinutes(w.endTime);
        return isTimeInWindow(checkMin, sMin, eMin);
      });
      if (covering) {
        triggeringWindow = covering;
        break;
      }
      minutesUntilPause++;
    }

    if (!triggeringWindow) {
      triggeringWindow = enabledEvaluatedWindows[0];
      minutesUntilPause = 1440;
    }

    const pauseTimeMinutes = (currentMinutes + minutesUntilPause) % 1440;
    const pauseTime12 = formatMinutesTo12Hour(pauseTimeMinutes);
    const durationFormatted = formatDurationMinutes(minutesUntilPause);

    const upcomingSummary: UpcomingRiskWindowSummary = {
      id: triggeringWindow.id,
      name: triggeringWindow.name,
      startTime: triggeringWindow.startTime,
      endTime: triggeringWindow.endTime,
      startTime12: triggeringWindow.startTime12,
      endTime12: triggeringWindow.endTime12,
      minutesUntilStart: minutesUntilPause,
      formattedUntilStart: durationFormatted
    };

    const message = `Auto Live active: Outside Risk Blackout Windows (${timezone}). Trading permitted. Next risk pause in ${durationFormatted} (at ${pauseTime12}: ${triggeringWindow.name} ${triggeringWindow.startTime12}–${triggeringWindow.endTime12}).`;

    return {
      enabled: true,
      inRiskWindow: false,
      windows: evaluatedWindows,
      activeWindow: null,
      activeWindows: [],
      nextUpcomingWindow: upcomingSummary,
      timezone,
      currentTime24,
      currentTime12,
      nextTransitionType: 'PAUSE',
      minutesUntilNextTransition: minutesUntilPause,
      timeUntilNextTransitionFormatted: durationFormatted,
      nextTransitionTime12: pauseTime12,
      totalConfiguredWindows: evaluatedWindows.length,
      activeConfiguredWindowsCount: enabledEvaluatedWindows.length,
      summary: `ACTIVE — Next risk blackout window begins in ${durationFormatted} at ${pauseTime12} (${triggeringWindow.name})`,
      message,
      startTime: triggeringWindow.startTime,
      endTime: triggeringWindow.endTime,
      startTime12: triggeringWindow.startTime12,
      endTime12: triggeringWindow.endTime12
    };
  }
}
