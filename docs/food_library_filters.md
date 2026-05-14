# food_library — Filter Design Spec

The growing spec of filter rules we want to apply to the `food_library` table, based on observations in `food_library_audit.md`.

This document starts empty and is built up incrementally as the audit reveals patterns worth filtering. Each rule has a reasoning trail back to the audit observation that motivated it — so anyone reading later understands why the rule exists.

When this document settles (all proposed rules either approved or rejected), it gets converted into:
1. A **cleanup migration** that removes existing rows matching the filter rules.
2. **Sync-time filters** in `scripts/d1_migrate/sync_usda.mjs` and `sync_on.mjs` so future imports never let those rows in.

Rules are NOT applied during the bulk import (that goes through everything raw — see `scripts/bulk_import/run.mjs`).

---

## Filter rule template

Each proposed rule looks like:

```
### Rule N — short name
**Status:** proposed | approved | rejected | deferred
**Source:** which sources / subtypes does this apply to (usda branded? all? specific subtype?)
**Condition:** the SQL predicate that identifies rows to remove
**Why:** plain-English reasoning, with link to audit observation
**Estimated impact:** approx number of rows this removes
**Decided:** YYYY-MM-DD by <user|claude>
```

---

## Proposed rules

*(Empty for now. Will grow as the audit progresses.)*

---

## Approved rules (becomes the cleanup migration)

*(Empty until we start approving rules.)*

---

## Rejected proposals

*(Track rules we considered but decided NOT to apply, with reasoning. So we don't keep re-suggesting the same idea.)*
