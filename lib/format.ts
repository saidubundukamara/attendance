const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(ms: number): string {
  return dateFormat.format(new Date(ms));
}

export function formatDateTime(ms: number): string {
  return dateTimeFormat.format(new Date(ms));
}
