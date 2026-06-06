-- Consolidate the 4 leverage skill families into the generic parent/child
-- variant model (parent_movement_id + variant_short_label + "Name [Variant]"
-- bracket naming), so they render via FamilyConsolidatedDetail like Sled /
-- Swimming. (T088 round-2 #5.)
--
-- APPLIED 2026-06-05 via the Supabase MCP (execute_sql), NOT via `supabase db
-- push`. Kept here for reference / reproducibility only — do not re-run on a DB
-- that already has the bracketed names + parent rows.
--
-- Per-family: the existing bare "X Hold" row (the full/hardest variant) becomes
-- the "X Hold [Full]" child, the "(Tuck/Straddle/Wall/...)" parens become
-- "[Tuck/Straddle/Wall/...]" brackets, a fresh parent container "X Hold" is
-- inserted, and the children are linked via parent_movement_id. Handstand Hold
-- had no bare row, so only the two parenthesised variants are re-bracketed under
-- a new parent. The 3 existing logged efforts are migrated to the new labels.

-- ===== PLANCHE =====
UPDATE movements SET name='Planche Hold [Tuck]',     variant_short_label='TUCK'     WHERE id='78904a59-f18e-4eb6-977d-13096db7c0b0';
UPDATE movements SET name='Planche Hold [Straddle]', variant_short_label='STRADDLE' WHERE id='f7713302-535c-49be-be3f-bf0c853bf46d';
UPDATE movements SET name='Planche Hold [Full]',     variant_short_label='FULL'     WHERE id='4e5080a6-eec8-425d-bc2f-9f60d8966d5b';
INSERT INTO movements (name, category, strength_type, hold_type) VALUES ('Planche Hold','strength','isometric','leverage');
UPDATE movements SET parent_movement_id=(SELECT id FROM movements WHERE name='Planche Hold' AND parent_movement_id IS NULL)
  WHERE name IN ('Planche Hold [Tuck]','Planche Hold [Straddle]','Planche Hold [Full]');

-- ===== FRONT LEVER =====
UPDATE movements SET name='Front Lever Hold [Tuck]', variant_short_label='TUCK' WHERE id='02a1a567-6c03-49d8-8884-197d089c4a1b';
UPDATE movements SET name='Front Lever Hold [Full]', variant_short_label='FULL' WHERE id='f647df81-f8a8-460a-a879-e7cea8304d73';
INSERT INTO movements (name, category, strength_type, hold_type) VALUES ('Front Lever Hold','strength','isometric','leverage');
UPDATE movements SET parent_movement_id=(SELECT id FROM movements WHERE name='Front Lever Hold' AND parent_movement_id IS NULL)
  WHERE name IN ('Front Lever Hold [Tuck]','Front Lever Hold [Full]');

-- ===== BACK LEVER =====
UPDATE movements SET name='Back Lever Hold [Tuck]', variant_short_label='TUCK' WHERE id='3749ffec-05a9-4ecb-81d8-09b234ffde68';
UPDATE movements SET name='Back Lever Hold [Full]', variant_short_label='FULL' WHERE id='e440e2a0-16a9-4a63-863d-612717c9ec7c';
INSERT INTO movements (name, category, strength_type, hold_type) VALUES ('Back Lever Hold','strength','isometric','leverage');
UPDATE movements SET parent_movement_id=(SELECT id FROM movements WHERE name='Back Lever Hold' AND parent_movement_id IS NULL)
  WHERE name IN ('Back Lever Hold [Tuck]','Back Lever Hold [Full]');

-- ===== HANDSTAND HOLD (no bare base) =====
UPDATE movements SET name='Handstand Hold [Wall]',         variant_short_label='WALL' WHERE id='5ff52680-6920-4678-aca1-133b1c6fbc90';
UPDATE movements SET name='Handstand Hold [Freestanding]', variant_short_label='FREE' WHERE id='60552916-8c73-45a8-b40c-438add91d23c';
INSERT INTO movements (name, category, strength_type, hold_type) VALUES ('Handstand Hold','strength','isometric','leverage');
UPDATE movements SET parent_movement_id=(SELECT id FROM movements WHERE name='Handstand Hold' AND parent_movement_id IS NULL)
  WHERE name IN ('Handstand Hold [Wall]','Handstand Hold [Freestanding]');

-- ===== EFFORT LABEL MIGRATION (3 efforts) =====
UPDATE efforts SET label = regexp_replace(label, '^Planche Hold ·',             'Planche Hold [Full] ·')      WHERE type='strength' AND label LIKE 'Planche Hold ·%';
UPDATE efforts SET label = regexp_replace(label, '^Planche Hold \(Straddle\) ·', 'Planche Hold [Straddle] ·')  WHERE type='strength' AND label LIKE 'Planche Hold (Straddle) ·%';
UPDATE efforts SET label = regexp_replace(label, '^Handstand Hold \(Wall\) ·',   'Handstand Hold [Wall] ·')    WHERE type='strength' AND label LIKE 'Handstand Hold (Wall) ·%';
