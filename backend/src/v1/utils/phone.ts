/**
 * One format for phone numbers, so the same person can't end up with two
 * accounts (01012345678 and +201012345678 used to be different users).
 * Egyptian mobiles become +20…; other numbers keep their digits with a leading +.
 */
export const normalizePhone = (raw: string): string => {
  const digits = raw.trim().replace(/[\s()-]/g, "").replace(/^00/, "+");
  if (/^01\d{9}$/.test(digits)) return `+2${digits}`;
  if (/^201\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+/.test(digits)) return digits;
  return digits;
};
