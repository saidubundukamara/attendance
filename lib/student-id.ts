// Every ID on the roster is this prefix followed by four digits, so students
// only type the last four.
export const STUDENT_ID_PREFIX = "90500";
export const STUDENT_ID_SUFFIX_LENGTH = 4;

// "5069" becomes "905005069". Anything else is returned unchanged, so a full
// ID typed or pasted in still works.
export function expandStudentId(entered: string): string {
  return /^\d{4}$/.test(entered) ? STUDENT_ID_PREFIX + entered : entered;
}

// The part a student types, or "" when the ID does not follow the pattern.
export function studentIdSuffix(id: string): string {
  const full = expandStudentId(id);
  return full.length === STUDENT_ID_PREFIX.length + STUDENT_ID_SUFFIX_LENGTH &&
    full.startsWith(STUDENT_ID_PREFIX)
    ? full.slice(STUDENT_ID_PREFIX.length)
    : "";
}
