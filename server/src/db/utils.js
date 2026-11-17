export function booleanToInteger(value) {
  return value ? 1 : 0;
}

export function integerToBoolean(value) {
  return value === 1;
}

export function stringifyJsonArray(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "[]";
  }
  return JSON.stringify(value);
}

export function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function coerceNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function coerceNullableString(value, allowEmpty = false) {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = String(value).trim();
  if (allowEmpty) {
    return trimmed;
  }
  return trimmed.length > 0 ? trimmed : null;
}
