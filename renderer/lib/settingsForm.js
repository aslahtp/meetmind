// Settings form helpers: dirty checks and the subset of fields a save actually sends.

// Form values can be objects (per-provider models, fallback), so compare structurally.
export function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// The fields the user changed since the form loaded. Saving only these means a save can't
// overwrite a setting with a stale value the form never touched (it once turned launch at
// login off whenever any other setting was saved).
export function changedFields(form, initial) {
  if (!initial) return { ...form };
  const changes = {};
  for (const key of Object.keys(form)) {
    if (!sameValue(form[key], initial[key])) changes[key] = form[key];
  }
  return changes;
}
