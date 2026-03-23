export function recentDaysWindowJst(
  now: Date,
  days: number
): { start: Date; end: Date; label: string } {
  const dateLabel = (date: Date): string => {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  const end = now;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    label: `${dateLabel(start)} - ${dateLabel(end)} の直近 ${days} 日`,
  };
}
