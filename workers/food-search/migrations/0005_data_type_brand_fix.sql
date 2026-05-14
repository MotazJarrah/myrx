-- Follow-up to 0004 — the original backfill used "has UPC?" as the sole
-- criterion. But USDA's branded_food set has thousands of legitimately
-- branded products with a brand field but no UPC (older entries from the
-- bulk-CSV import era). Those got mis-tagged as 'generic', which made the
-- short-query generics-first ranking tweak surface "JALAPENO TOMATO KETCHUP
-- by HEINZ" when a user searched a single word.
--
-- The fixed rule: a row is BRANDED if it has either a UPC barcode OR a
-- brand name. GENERIC only when both fields are missing — those are the
-- canonical ingredients from USDA Foundation Foods / SR Legacy, OpenNutrition
-- generics, or admin-curated custom entries with no brand attached.
--
-- This re-runs the backfill against every row in food_library.

UPDATE food_library
SET data_type = CASE
  WHEN (upc   IS NOT NULL AND upc   != '')
    OR (brand IS NOT NULL AND brand != '')
  THEN 'branded'
  ELSE 'generic'
END;
