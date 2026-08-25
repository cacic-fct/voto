import { format, isValid, parse } from 'date-fns';

const DATE_ONLY_FORMAT = 'yyyy-MM-dd';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses an ISO calendar date as a local calendar day, rather than an instant.
 * This keeps date-only answers stable for voters in every time zone.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const date = parse(value, DATE_ONLY_FORMAT, new Date());
  return isValid(date) && format(date, DATE_ONLY_FORMAT) === value ? date : null;
}

/** Serializes a local calendar day without converting it to UTC. */
export function formatDateOnly(value: Date | null | undefined): string {
  return value && isValid(value) ? format(value, DATE_ONLY_FORMAT) : '';
}

/** Combines a local calendar day and native time input into a UTC timestamp. */
export function combineDateAndTime(
  date: Date | null | undefined,
  time: string,
): string | null {
  if (!date || !isValid(date)) {
    return null;
  }

  const parsed = parse(time, 'HH:mm', date);
  if (!isValid(parsed) || format(parsed, 'HH:mm') !== time) {
    return null;
  }

  return parsed.toISOString();
}
