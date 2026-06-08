/**
 * Meal-slot definitions — the default meal layout, the anchor (non-removable)
 * slots, and the extra presets shown in the insert picker.
 *
 * These three data exports are the only live part of what used to be the
 * end-user FoodLogDrawer component. Food logging is mobile-only now, so the
 * drawer component + all its helpers were removed (Jun 2026) and the data
 * that the admin/coach MealLayoutEditor still needs was moved here.
 */

export const DEFAULT_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '☀️' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🌤️' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🌙' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
]

// Anchor slots cannot be removed by the user
export const ANCHOR_IDS = new Set(['breakfast', 'lunch', 'dinner', 'snacks'])

// Pre-built extra meal options shown in the insert picker
export const EXTRA_PRESETS = [
  { id: 'morning_snack',   label: 'Morning Snack',   emoji: '🥐' },
  { id: 'pre_workout',     label: 'Pre-Workout',     emoji: '⚡' },
  { id: 'post_workout',    label: 'Post-Workout',    emoji: '💪' },
  { id: 'afternoon_snack', label: 'Afternoon Snack', emoji: '🍇' },
  { id: 'evening_meal',    label: 'Evening Meal',    emoji: '🌆' },
]
