-- Drop the meal_slot CHECK constraint that limited values to the original 4
-- anchor slots ('breakfast', 'lunch', 'dinner', 'snacks').
--
-- The app has since added 5 preset extras (morning_snack, pre_workout,
-- post_workout, afternoon_snack, evening_meal) plus user-defined custom
-- slots. The CHECK constraint was silently rejecting inserts for any
-- non-anchor slot, making it look like custom meals couldn't accept foods.
--
-- The text column is now a free-form id; the FoodLogDrawer component (web +
-- mobile) is the source of truth for which slot ids exist for a given user.

ALTER TABLE food_logs DROP CONSTRAINT IF EXISTS food_logs_meal_slot_check;
