export function examStatus(examDate: string, today = new Date().toLocaleDateString('sv-SE')): string {
  const end = Date.parse(`${examDate}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return '未设置日期';
  const days = Math.round((end - start) / 86400000);
  return days < 0 ? '考试已结束' : days === 0 ? '今天考试' : `倒计时 ${days} 天`;
}
