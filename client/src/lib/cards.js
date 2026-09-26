const KEY = 'engportal_print_cards';

/** Hands credentials to the print page (kept only in this tab's session storage). */
export function openCards(cards) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cards));
  } catch { /* storage full/blocked — the print page will say there's nothing to print */ }
  window.open('/print/cards', '_blank');
}

export function readCards() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearCards() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
