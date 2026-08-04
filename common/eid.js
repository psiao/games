// ---------------------------------------------------------------------------
// eid.js — Employee/VA ID formats accepted across ALL games.
// Add or change accepted ID formats here ONCE; every game picks it up.
// Current: VS+5 digits, MLG+4, A+4, INT+4.
// ---------------------------------------------------------------------------
export const EID_RE = /^(VS\d{5}|MLG\d{4}|A\d{4}|INT\d{4})$/;
