/**
 * Font Regulator — Service Worker (MV3)
 *
 * Responsibilities:
 * - Re-inject content script on tab navigation (when content scripts might
 *   not have fired, e.g. the extension was installed after the page loaded).
 * - Forward "applyRules" messages from popup to the active content script
 *   when the content script is not yet listening.
 * 
 * Τι ακριβως κανει αυτο το αρχειο:
 * - Ακούει για το γεγονός της εγκατάστασης ή ενημέρωσης 
 * της επέκτασης και καταγράφει ένα μήνυμα στο κονσόλα.
 * - Μπορεί να χρησιμοποιηθεί για να επανενεργοποιήσει το content script σε περιπτώσεις που δεν      έχει   ενεργοποιηθεί, όπως όταν η επέκταση εγκαθίσταται μετά τη φόρτωση της σελίδας.
 * - Μπορεί να προωθήσει μηνύματα "applyRules" από το popup προς το ενεργό content script όταν αυτό δεν είναι ακόμα έτοιμο να ακούσει.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FontRegulator] Extension installed / updated.');
});
