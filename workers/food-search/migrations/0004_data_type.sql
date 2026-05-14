-- Adds a `data_type` column to `food_library` for source-agnostic classification.
--
-- Universal rule (applies to USDA, ON, MYRX equally):
--   row WITH a UPC barcode    → data_type = 'branded'  (packaged product)
--   row WITHOUT a UPC barcode → data_type = 'generic'  (canonical ingredient or custom entry)
--
-- The rule is automatic — the sync scripts and the Worker's myrx-create path
-- derive `data_type` from `upc` presence at INSERT time. No human classification.
--
-- This is what makes USDA Foundation Foods and SR Legacy (Lettuce, Tomato, etc.)
-- searchable: they don't have UPCs, so they were previously filtered out by
-- `shouldSkip`. After this column lands AND the sync scripts are updated to
-- tag generics correctly, those entries flow into the DB normally.
--
-- Future-flex: if/when we want a third category (e.g. 'recipe' for multi-
-- ingredient meals, or 'supplement' for protein powders), it's just a new
-- string value in the same column. No new column needed.

ALTER TABLE food_library ADD COLUMN data_type TEXT;

-- Backfill existing rows. All current rows happen to have UPCs (the old
-- shouldSkip filter ensured that), but we use the same upc-based rule
-- universally so this is self-documenting and safe even if a future
-- migration order leaves some rows UPC-less.
UPDATE food_library
SET data_type = CASE
  WHEN upc IS NOT NULL AND upc != '' THEN 'branded'
  ELSE 'generic'
END
WHERE data_type IS NULL;
