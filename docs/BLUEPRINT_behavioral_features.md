# MyRX Behavioral Features Blueprint
## Feature 1: Daily Card Story System + Feature 2: Weekend Resilience System

**Version:** 1.0  
**Status:** Ready for implementation  
**Paste this file to Claude and say: "implement the blueprint"**

---

## OVERVIEW

Two interconnected behavioral systems designed to drive identity-based habit change and prevent unstructured-day dietary collapse. Both are coach-assisted (admin can configure content) and data-driven (personalized based on user history).

---

# PART 1: DAILY CARD STORY SYSTEM

## What It Is

A daily micro-lesson system delivered as swipeable cards (3–5 per day, ~2 min total). Each card belongs to a "module" (a themed series of ~7–14 days). Modules are sequenced into a "program" that spans the user's journey. Cards use CBT reframing, identity language, and behavioral nudges — not generic nutrition facts.

## Scientific Basis (implement as comments/tooltips in admin)

- **CBT psychoeducation** — reframe thinking patterns around food
- **Implementation intentions** — "if X then Y" plans reduce failure rate by 2–3x
- **Identity-based habits** — "I am someone who…" language over "I should…"
- **Spaced repetition** — key concepts resurface every 5–7 days
- **Commitment devices** — early low-stakes questions create behavioral compliance

---

## 1.1 DATABASE SCHEMA

```sql
-- Programs: top-level curriculum (e.g., "12-Week Transformation")
CREATE TABLE card_programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  cover_emoji text DEFAULT '📚',
  total_days  int  NOT NULL DEFAULT 84,
  is_active   boolean DEFAULT true,
  sort_order  int  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Modules: themed chapters within a program (e.g., "Understanding Hunger", "Stress & Food")
CREATE TABLE card_modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid REFERENCES card_programs(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  cover_emoji text DEFAULT '🎯',
  day_start   int  NOT NULL, -- which program day this module starts
  day_end     int  NOT NULL, -- which program day this module ends
  sort_order  int  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- Cards: individual lesson cards within a module
CREATE TABLE cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    uuid REFERENCES card_modules(id) ON DELETE CASCADE,
  day_number   int  NOT NULL, -- which program day this card is shown (1-based)
  position     int  NOT NULL DEFAULT 1, -- order within the day (1, 2, 3...)
  card_type    text NOT NULL CHECK (card_type IN (
                 'lesson',      -- text + illustration, purely educational
                 'reflection',  -- ask the user a question, they type/select answer
                 'commitment',  -- user makes a micro-commitment (stored)
                 'quiz',        -- multiple choice, right answer revealed
                 'celebration', -- milestone acknowledgment
                 'reframe'      -- present a common thought + a better alternative
               )),
  title        text NOT NULL,
  body         text NOT NULL,       -- main content (markdown supported)
  emoji        text,                -- decorative emoji for the card
  bg_color     text DEFAULT 'teal', -- visual theme: teal | purple | amber | rose | blue
  -- For reflection/commitment cards:
  prompt       text,                -- the question to ask
  input_type   text CHECK (input_type IN ('text', 'scale', 'choice', null)),
  choices      jsonb,               -- for choice input: ["Option A", "Option B", "Option C"]
  -- For quiz cards:
  correct_index int,                -- index of correct answer in choices array
  explanation  text,                -- shown after quiz answer
  -- For reframe cards:
  old_thought  text,                -- "I already ruined today, might as well eat everything"
  new_thought  text,                -- "One slip doesn't erase my progress"
  created_at   timestamptz DEFAULT now()
);

-- User program enrollment
CREATE TABLE user_programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id  uuid REFERENCES card_programs(id),
  started_at  date NOT NULL DEFAULT current_date,
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, program_id)
);

-- User card progress (which cards have been seen/completed)
CREATE TABLE user_card_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id      uuid REFERENCES cards(id) ON DELETE CASCADE,
  program_id   uuid REFERENCES card_programs(id),
  completed_at timestamptz DEFAULT now(),
  -- For reflection/commitment cards, store what they said:
  response     text,
  response_raw jsonb, -- full response data for scale/choice types
  UNIQUE(user_id, card_id)
);

-- RLS
ALTER TABLE card_programs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_modules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_programs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_card_progress   ENABLE ROW LEVEL SECURITY;

-- Programs/modules/cards: readable by all authenticated users
CREATE POLICY "cards readable by authenticated" ON cards FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "modules readable by authenticated" ON card_modules FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "programs readable by authenticated" ON card_programs FOR SELECT USING (auth.role() = 'authenticated');

-- User-specific rows: owned by user
CREATE POLICY "user_programs owned" ON user_programs USING (auth.uid() = user_id);
CREATE POLICY "user_card_progress owned" ON user_card_progress USING (auth.uid() = user_id);

-- Admin write access (uses service_role or is_admin check)
CREATE POLICY "admin write cards" ON cards FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "admin write modules" ON card_modules FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "admin write programs" ON card_programs FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- RPC: get today's cards for the current user
CREATE OR REPLACE FUNCTION get_todays_cards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_program record;
  v_day_number int;
  v_cards jsonb;
BEGIN
  -- Get active enrollment
  SELECT up.*, cp.title as program_title
  INTO v_program
  FROM user_programs up
  JOIN card_programs cp ON cp.id = up.program_id
  WHERE up.user_id = v_user_id AND up.is_active = true
  ORDER BY up.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', false, 'cards', '[]'::jsonb);
  END IF;

  -- Calculate current day in program
  v_day_number := (current_date - v_program.started_at) + 1;

  -- Get today's cards, excluding already completed
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'card_type', c.card_type,
      'title', c.title,
      'body', c.body,
      'emoji', c.emoji,
      'bg_color', c.bg_color,
      'prompt', c.prompt,
      'input_type', c.input_type,
      'choices', c.choices,
      'correct_index', c.correct_index,
      'explanation', c.explanation,
      'old_thought', c.old_thought,
      'new_thought', c.new_thought,
      'position', c.position,
      'completed', (ucp.id IS NOT NULL),
      'response', ucp.response
    ) ORDER BY c.position
  )
  INTO v_cards
  FROM cards c
  JOIN card_modules cm ON cm.id = c.module_id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = v_user_id
  WHERE cm.program_id = v_program.program_id
    AND c.day_number = v_day_number;

  RETURN jsonb_build_object(
    'enrolled', true,
    'program_title', v_program.program_title,
    'day_number', v_day_number,
    'cards', COALESCE(v_cards, '[]'::jsonb)
  );
END;
$$;
```

---

## 1.2 FILE STRUCTURE

```
src/
  pages/
    DailyCards.jsx              ← main user-facing page (the card reader)
    admin/
      AdminCards.jsx            ← admin: manage programs, modules, cards
  components/
    cards/
      CardReader.jsx            ← full-screen swipeable card viewer
      CardLesson.jsx            ← lesson card layout
      CardReflection.jsx        ← reflection/commitment card layout
      CardQuiz.jsx              ← quiz card layout
      CardReframe.jsx           ← old-thought → new-thought layout
      CardCelebration.jsx       ← milestone card layout
      CardProgress.jsx          ← progress dots at top (1 of 4)
      CardComplete.jsx          ← "All done for today!" screen
  hooks/
    useCards.js                 ← data fetching, progress marking
```

---

## 1.3 COMPONENT SPECS

### DailyCards.jsx (User Page)
- Route: `/cards` or accessible from dashboard
- Shows a "Your lesson for today" entry card with:
  - Program name + day number ("Day 12 of 84")
  - Card count ("4 cards · ~3 min")
  - Start button → opens CardReader fullscreen overlay
- If all cards completed today: show completion state with streak count
- If not enrolled: show program picker (list of available programs)
- Pull today's data from `get_todays_cards()` RPC on mount

### CardReader.jsx
- Full-screen overlay (z-50, dark backdrop)
- Renders the appropriate card type component based on `card_type`
- Progress bar/dots at top: completed dots filled, current dot pulsing
- Swipe right or tap "Next" to advance
- Cannot go back (forward-only, like Noom)
- On last card → show CardComplete
- Each card completion calls: `supabase.from('user_card_progress').insert({...})`
- For reflection/commitment cards: cannot advance until they type/select something (min 1 char for text, must select for choice)

### CardLesson.jsx
```
┌─────────────────────────────┐
│  [emoji]                    │
│                             │
│  [title - large]            │
│                             │
│  [body - readable prose]    │
│                             │
│  [bg_color gradient bg]     │
└─────────────────────────────┘
```

### CardReframe.jsx
```
┌─────────────────────────────┐
│  Common thought:            │
│  ┌─────────────────────┐    │
│  │ ❌ [old_thought]    │    │  ← red-tinted card
│  └─────────────────────┘    │
│                             │
│  Try this instead:          │
│  ┌─────────────────────┐    │
│  │ ✅ [new_thought]    │    │  ← green-tinted card
│  └─────────────────────┘    │
└─────────────────────────────┘
```

### CardQuiz.jsx
- Show question, then 3-4 choice buttons
- Tap a choice → reveal correct/incorrect with color
- Show `explanation` text below
- "Got it" button to advance (only appears after answering)

### CardReflection.jsx
- Show `prompt` prominently
- If `input_type === 'text'`: textarea, free response
- If `input_type === 'scale'`: 1–10 slider with emoji anchors
- If `input_type === 'choice'`: pill buttons from `choices` array
- Response is saved to `user_card_progress.response`

---

## 1.4 ADMIN PANEL: AdminCards.jsx

Three-level hierarchy editor: Programs → Modules → Cards

### Programs Tab
- List of programs (title, total days, active toggle)
- Create/edit program modal: title, description, emoji, total_days

### Modules Tab (when a program is selected)
- List of modules with day range shown
- Create/edit module: title, description, emoji, day_start, day_end

### Cards Tab (when a module is selected)
- List cards sorted by day_number + position
- Each row: day badge, position, card_type pill, title
- Create/edit card full modal with all fields:
  - Always: card_type (dropdown), day_number, position, title, body, emoji, bg_color
  - Conditional fields shown based on card_type:
    - reflection/commitment: prompt, input_type, choices (JSON array editor)
    - quiz: choices, correct_index, explanation
    - reframe: old_thought, new_thought

### Bulk card import
- Accept CSV with columns: day_number, position, card_type, title, body, emoji, prompt, choices
- Parse and preview before import
- One click to insert all

---

## 1.5 DASHBOARD INTEGRATION

On the main user dashboard, add a "Today's Lesson" widget:
- If cards not started today: show CTA card ("3 cards waiting · Day 12")
- If partially done: show progress ("2 of 4 complete")
- If all done: show green checkmark + streak ("🔥 Day 12 streak!")
- Tapping the widget opens CardReader directly

---

## 1.6 SEED DATA: First Module (Week 1)

Insert this seed data when implementing. This is the "Why You're Here" module (Days 1–7):

**Day 1, Card 1** — lesson — "Welcome" — Body: "This isn't another diet. Diets tell you what to eat. We're going to change how you *think* about food. That's the difference between trying for 6 weeks and succeeding for life."

**Day 1, Card 2** — commitment — "Your Why" — Prompt: "In one sentence, why does this matter to you right now?" — input_type: text

**Day 1, Card 3** — lesson — "Identity First" — Body: "Every action you take is a vote for the person you want to become. When you choose the salad, you're not being restrictive — you're casting a vote for your identity. What kind of person do you want to be?"

**Day 2, Card 1** — reframe — "The All-or-Nothing Trap" — old_thought: "I already had one cookie, the day is ruined" — new_thought: "One cookie is one cookie. The next choice is always a fresh start."

**Day 2, Card 2** — quiz — "What controls hunger?" — choices: ["Willpower", "Hormones and brain signals", "Stomach size", "Blood sugar only"] — correct_index: 1 — explanation: "Hunger is driven by hormones like ghrelin and leptin, plus brain reward signals. It's biology, not weakness."

**Day 3, Card 1** — lesson — "Hunger vs. Appetite" — Body: "Hunger is physical — your body needs fuel. Appetite is psychological — your brain wants a reward or comfort. Learning to tell them apart is one of the most powerful skills in this program."

**Day 3, Card 2** — reflection — "Right now, pause." — Prompt: "On a scale of 1–10, how hungry are you physically right now? (1 = completely full, 10 = starving)" — input_type: scale

*(Continue pattern for days 4–7 covering: stress eating, environment design, social pressure, the weekend trap preview)*

---

# PART 2: WEEKEND / UNSTRUCTURED DAY RESILIENCE SYSTEM

## What It Is

A structured check-in and pre-commitment system that activates on rest days and weekends. Instead of leaving the user on their own, the app provides lightweight scaffolding: a Friday evening preview, a morning anchor ritual, a flex budget concept, and post-day reflection. The system learns their patterns and surfaces them.

---

## 2.1 DATABASE SCHEMA

```sql
-- Weekend/rest day check-ins
CREATE TABLE day_checkins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  checkin_date    date NOT NULL,
  checkin_type    text NOT NULL CHECK (checkin_type IN (
                    'friday_preview',  -- Friday evening: plan the weekend
                    'morning_anchor',  -- Morning of rest/weekend day
                    'evening_reflect'  -- Evening: how did it go?
                  )),
  -- Friday preview fields
  weekend_events  text,    -- "dinner with family Saturday, brunch Sunday"
  risk_level      int,     -- user's self-assessed risk 1–5
  strategy        text,    -- what they plan to do about it
  -- Morning anchor fields
  anchor_meal     text,    -- one meal they commit to eating on plan
  flex_calories   int,     -- how many flex calories they're allowing today
  todays_goal     text,    -- one sentence goal for the day
  -- Evening reflection fields
  rating          int,     -- 1–5 how well did the day go
  what_helped     text,    -- what worked
  what_didnt      text,    -- what didn't
  notes           text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(user_id, checkin_date, checkin_type)
);

-- Pattern detection: pre-computed weekly summary
-- (populated by a cron/trigger after each week ends)
CREATE TABLE user_weekly_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  weekday_avg_cal int,
  weekend_avg_cal int,
  worst_day       text,  -- e.g. "Sunday"
  best_day        text,
  overflow_cal    int,   -- weekend_avg_cal - weekday_avg_cal
  checkin_streak  int,   -- consecutive weekend check-ins completed
  notes           jsonb, -- coach observations
  created_at      timestamptz DEFAULT now(),
  UNIQUE(user_id, week_start)
);

-- Flex budget config per user (coach sets this)
CREATE TABLE user_flex_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_flex_cal int  DEFAULT 500,   -- total extra calories allowed per week
  weekend_days    text[] DEFAULT ARRAY['Saturday','Sunday'], -- which days count
  rest_day_flex   int  DEFAULT 200,   -- extra allowed on non-weekend rest days
  updated_by      uuid REFERENCES auth.users(id), -- coach who set it
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE day_checkins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_weekly_patterns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_flex_config       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkins owned" ON day_checkins USING (auth.uid() = user_id);
CREATE POLICY "patterns owned" ON user_weekly_patterns USING (auth.uid() = user_id);
CREATE POLICY "flex owned" ON user_flex_config USING (auth.uid() = user_id);
CREATE POLICY "admin read flex" ON user_flex_config FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "admin write flex" ON user_flex_config FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- RPC: get weekend readiness data (patterns + this week's check-ins)
CREATE OR REPLACE FUNCTION get_weekend_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_flex    record;
  v_pattern record;
  v_checkins jsonb;
BEGIN
  SELECT * INTO v_flex FROM user_flex_config WHERE user_id = v_user_id;
  SELECT * INTO v_pattern FROM user_weekly_patterns
    WHERE user_id = v_user_id ORDER BY week_start DESC LIMIT 1;

  SELECT jsonb_agg(row_to_json(dc)) INTO v_checkins
  FROM day_checkins dc
  WHERE dc.user_id = v_user_id
    AND dc.checkin_date >= date_trunc('week', current_date);

  RETURN jsonb_build_object(
    'flex_config', row_to_json(v_flex),
    'last_pattern', row_to_json(v_pattern),
    'this_week_checkins', COALESCE(v_checkins, '[]'::jsonb)
  );
END;
$$;
```

---

## 2.2 FILE STRUCTURE

```
src/
  pages/
    WeekendReady.jsx              ← main page (hub for all check-in types)
  components/
    weekend/
      FridayPreview.jsx           ← Friday evening planning flow
      MorningAnchor.jsx           ← morning commitment card
      EveningReflect.jsx          ← evening reflection
      WeekendInsights.jsx         ← pattern display ("Your worst day is Sunday")
      FlexBudgetMeter.jsx         ← visual flex calorie tracker
      StreakBadge.jsx             ← weekend check-in streak
  hooks/
    useWeekend.js                 ← data + submission logic
```

---

## 2.3 CHECK-IN FLOWS (Detailed UX)

### Friday Preview (shown Friday after 5pm)
A gentle nudge appears on the dashboard: "The weekend starts soon. Take 2 min to plan ahead."

**Flow:**
1. **Card 1 — Event scan:**
   "What does your weekend look like? Any meals out, events, travel, or situations that might be tricky?"
   → Free text input

2. **Card 2 — Risk check:**
   "How challenging does this weekend feel?" 
   → 1–5 scale (1=Easy, 5=Danger zone)

3. **Card 3 — Strategy (conditional on risk ≥ 3):**
   "What's one thing you'll do to stay on track?"
   → Quick-pick chips: ["Eat before I go out", "Order first at restaurants", "Keep healthy snacks ready", "Set a check-in reminder", "Allow one flex meal and move on"]
   + free text option

4. **Completion:** "Plan locked in. We'll check in Saturday morning." → saves to `day_checkins` as `friday_preview`

---

### Morning Anchor (shown Saturday and Sunday morning, and on logged rest days)
Appears as a banner on the dashboard if no workout is logged and it's 6am–11am.

**Flow:**
1. **Card 1 — Anchor meal:**
   "What's one meal today you'll keep fully on plan?"
   → Quick-pick: ["Breakfast", "Lunch", "Dinner", "All of them"] or custom text

2. **Card 2 — Flex decision:**
   "You have [X] flex calories this weekend. How do you want to use today?"
   → Options: ["Stay fully on plan", "Use [X/2] flex today", "Use all [X] today", "Decide later"]

3. **Card 3 — One goal:**
   "What's your one focus for today's nutrition?"
   → Pre-filled suggestions based on their pattern (e.g., if they always overeat at dinner: "Stop eating when 80% full at dinner")
   + editable free text

4. **Completion:** Shows a simple commitment card they can screenshot:
   ```
   Today's plan:
   ✅ Anchor: Breakfast
   🍽️  Flex: 250 cal  
   🎯 Goal: Eat slowly at dinner
   ```
   → saves to `day_checkins` as `morning_anchor`

---

### Evening Reflection (shown Saturday and Sunday after 7pm, and on rest day evenings)
**Flow:**
1. **Card 1 — Quick rating:**
   "How did today go nutritionally?"
   → 5 emoji options: 😫 → 😕 → 😐 → 🙂 → 😄

2. **Card 2 — What worked:**
   "What helped you today?" (optional but encouraged)
   → Free text

3. **Card 3 — What didn't (only if rating ≤ 3):**
   "What made it hard? No judgment — patterns help us plan better."
   → Free text + chips: ["Stress", "Social pressure", "Boredom", "Tired", "No food prep", "Emotional eating"]

4. **Completion:** If rating ≤ 2, show a reframe card from the card system library (tagged as weekend-relevant). If rating ≥ 4, show celebration.

---

## 2.4 PATTERN INSIGHTS (WeekendInsights.jsx)

Shown on the WeekendReady page as a scrollable insight panel. Uses `user_weekly_patterns` data.

**Insight cards to show:**

1. **"Your Toughest Day"**
   "Based on your last 4 weeks, Sundays are your hardest day. You average 480 extra calories on Sundays vs your weekday average."
   → CTA: "Set a Sunday anchor reminder"

2. **"Weekend Drift"** (if weekend_avg > weekday_avg by >300 cal)
   "Your weekdays are 📈 solid. Weekends add an average of [N] extra calories per week — that's about [N/3500] lbs/month of drift."
   → Shows as a simple bar chart: Mon–Sun bars

3. **"Check-in Streak"**
   "You've planned ahead [N] weekends in a row. Users who do this consistently lose 2x more than those who don't."
   → Streak badge with fire emoji

4. **"Getting Better"** (if overflow_cal trending down over 4 weeks)
   "Your weekend calorie gap is closing. You're improving."

---

## 2.5 FLEX BUDGET METER (FlexBudgetMeter.jsx)

Visual component shown on dashboard on weekends/rest days.

```
Weekend Flex Budget
████████░░░░░░░  250 / 500 cal used

Saturday: 250 cal ✓
Sunday:   remaining
```

- Pulls from `user_flex_config` for the budget
- Pulls from food logs (existing nutrition table) to calculate actual usage
- Color: green → yellow → red as budget fills
- Tapping it opens WeekendReady page

---

## 2.6 NOTIFICATIONS / TRIGGERS

These are reminder triggers (not push notifications yet — use in-app banners):

| Trigger | When | Message |
|---|---|---|
| Friday Preview | Friday, 5pm–8pm, if no friday_preview logged | "The weekend is coming. 2-min plan?" |
| Morning Anchor | Sat/Sun, 7am–10am, if no morning_anchor today | "Good morning! Set your anchor for today." |
| Evening Reflect | Sat/Sun, 7pm–9pm, if morning_anchor was done but no evening_reflect | "How did today go?" |
| Rest Day | Any day flagged as rest + no workout logged, morning | "Rest day! Set your anchor meal." |

Implement as: a computed value in the dashboard that checks today's date + existing check-ins and returns which banner(s) to show. No external push needed initially — in-app is sufficient.

---

## 2.7 ADMIN VIEW: User Weekend Patterns

In the admin client detail page, add a "Weekend Patterns" section showing:
- Last 4-week bar chart (weekday avg vs weekend avg)
- Their worst day of the week
- Check-in compliance rate (% of weekends with morning anchor completed)
- Flex budget config + edit button
- All their past check-in responses (scrollable, read-only)

---

# PART 3: INTEGRATION BETWEEN BOTH SYSTEMS

## How They Connect

1. **Cards can reference weekend patterns:**
   Day 3 of Week 1 module previews the weekend concept. Day 7 card is: "Your First Weekend Plan" (a commitment card that acts as the first Morning Anchor, before the dedicated system kicks in).

2. **Weekend reflections feed card content:**
   If a user reports stress eating in 2 consecutive evening reflections, the card system can surface the "Emotional Hunger" module next (this requires an admin action for now, or a flag the system sets).

3. **Shared streak display:**
   On the dashboard, show a combined streak: cards streak + weekend check-in streak side by side.

---

# PART 4: DASHBOARD WIDGET LAYOUT

On the main user dashboard, add two widgets below the existing stats:

### Widget 1: Today's Lesson
```
┌────────────────────────────────┐
│ 📚 Today's Lesson    Day 12   │
│ "The Weekend Mindset"          │
│ ● ● ● ○  3 of 4 complete      │
│                  [Continue →]  │
└────────────────────────────────┘
```

### Widget 2: Weekend Ready (only Fri–Sun or rest days)
```
┌────────────────────────────────┐
│ 🎯 Weekend Ready               │
│ Anchor: Breakfast ✓            │
│ Flex: ████░░ 250/500 cal       │
│ Evening check-in pending       │
│                   [Check in →] │
└────────────────────────────────┘
```

---

# PART 5: IMPLEMENTATION ORDER

Follow this sequence when implementing:

## Phase 1 — Database (30 min)
1. Run all SQL from Part 1 and Part 2 schemas via Supabase migrations
2. Seed the first module (Day 1–7 cards from section 1.6)
3. Test `get_todays_cards()` RPC returns correct data
4. Test `get_weekend_data()` RPC

## Phase 2 — Card System UI (2–3 hours)
1. Build `CardReader.jsx` with swipe/tap navigation
2. Build all 5 card type components (lesson, reframe, quiz, reflection, commitment)
3. Build `DailyCards.jsx` page with enrollment flow
4. Wire up progress saving to `user_card_progress`
5. Add dashboard widget

## Phase 3 — Admin Card Editor (1–2 hours)
1. Build `AdminCards.jsx` with program/module/card hierarchy
2. Implement conditional field rendering based on card_type
3. Add CSV bulk import

## Phase 4 — Weekend System UI (2–3 hours)
1. Build `FridayPreview.jsx`, `MorningAnchor.jsx`, `EveningReflect.jsx`
2. Build `WeekendReady.jsx` hub page
3. Build `FlexBudgetMeter.jsx`
4. Wire up pattern insights from `user_weekly_patterns`
5. Add dashboard banner trigger logic
6. Add dashboard widget

## Phase 5 — Integration (1 hour)
1. Connect card system streak + weekend streak on dashboard
2. Add "Weekend Patterns" section to admin client view
3. Connect flex budget meter to existing nutrition logs

---

# PART 6: TECH NOTES FOR CLAUDE

## Existing patterns to follow:
- Use `supabase.rpc()` for RPCs, not direct table queries where possible
- Admin writes go through standard Supabase client (RLS handles auth)
- DeleteAction component exists at `src/components/DeleteAction.jsx` — reuse swipe pattern for CardReader
- Use existing Tailwind color system; no new colors
- All new pages added to router in `src/App.jsx`
- Admin pages added to `src/pages/admin/` and registered in AdminShell nav
- Form patterns: follow AdminMovements.jsx add-behind-button pattern
- Loading states: use existing skeleton/spinner patterns from codebase

## Card color system (bg_color values → Tailwind classes):
```js
const CARD_THEMES = {
  teal:   'from-teal-500/20   to-teal-600/10   border-teal-500/30',
  purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
  amber:  'from-amber-500/20  to-amber-600/10  border-amber-500/30',
  rose:   'from-rose-500/20   to-rose-600/10   border-rose-500/30',
  blue:   'from-blue-500/20   to-blue-600/10   border-blue-500/30',
  green:  'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
}
```

## Key state for CardReader:
```js
const [currentIndex, setCurrentIndex] = useState(0)
const [responses, setResponses] = useState({}) // cardId → response
const [answered, setAnswered] = useState({})   // cardId → boolean (quiz answered)
const canAdvance = (card) => {
  if (card.card_type === 'reflection' || card.card_type === 'commitment') {
    return !!responses[card.id]?.trim()
  }
  if (card.card_type === 'quiz') return !!answered[card.id]
  return true
}
```

---

*End of Blueprint — MyRX Behavioral Features v1.0*
*When ready: paste this file to Claude and say "implement the blueprint"*
