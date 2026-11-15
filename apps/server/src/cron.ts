import { CronExpressionParser } from "cron-parser";

/** Zone used when a cron trigger has none: VIGIL_TZ, then the system zone. */
export function defaultZone(): string {
  return process.env.VIGIL_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Returns an error text for a bad zone, or null when the zone is a known IANA name. */
export function zoneError(timezone: string): string | null {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return null;
  } catch {
    return `Unknown time zone: ${timezone}`;
  }
}

/**
 * Returns an error text for a bad expression or zone, or null when both are fine.
 * Only the five-field form is accepted: no seconds, no `@` aliases, no `H` (random) values,
 * so a schedule always means the same thing every day.
 */
export function cronError(expression: string, timezone?: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return "Cron expression needs exactly 5 fields: minute hour day month weekday";
  if (/[@H]/i.test(expression.replace(/\b(MON|TUE|WED|THU|FRI|SAT|SUN|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, ""))) {
    return "Cron expression may not use @ aliases or H values";
  }
  const zone = timezone ?? defaultZone();
  const bad = zoneError(zone);
  if (bad) return bad;
  try {
    CronExpressionParser.parse(expression, { tz: zone });
    return null;
  } catch (err) {
    return `Bad cron expression: ${err instanceof Error ? err.message : "cannot parse"}`;
  }
}

/** Latest scheduled time at or before `now`, or null if the expression has none. */
export function latestTickAtOrBefore(expression: string, timezone: string | undefined, now: Date): Date | null {
  // prev() is strictly before currentDate, so look from 1 ms later to include an exact hit.
  const it = CronExpressionParser.parse(expression, { tz: timezone ?? defaultZone(), currentDate: new Date(now.getTime() + 1) });
  try {
    return it.prev().toDate();
  } catch {
    return null;
  }
}

/** First scheduled time strictly after `now`, or null. */
export function nextTickAfter(expression: string, timezone: string | undefined, now: Date): Date | null {
  const it = CronExpressionParser.parse(expression, { tz: timezone ?? defaultZone(), currentDate: now });
  try {
    return it.next().toDate();
  } catch {
    return null;
  }
}
