/** Short booking reference shown to people: MW- and the first 6 hex characters of the id. */
export const bookingRef = (id: string) => `MW-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
