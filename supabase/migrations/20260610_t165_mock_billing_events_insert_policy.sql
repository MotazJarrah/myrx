-- T165 MOCK-RAIL ONLY: let a signed-in user insert their OWN billing_events
-- rows. The mock store provider (mobile/src/lib/billing.ts) writes a
-- transaction record on simulated purchase/lapse so the Billing tab's
-- Transactions list behaves like the real rail (where the store webhook
-- writes these rows with the service role).
--
-- ⚠ REMOVE THIS POLICY when the real Apple/Google IAP rail lands —
-- production athletes must never fabricate their own billing history.
-- Tracked in the T165 ledger entry's pending list.
CREATE POLICY "Mock rail: users insert own billing events"
ON public.billing_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
