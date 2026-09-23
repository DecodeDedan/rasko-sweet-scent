-- ============================================================================
-- 0018  Employee records are owner-write only.
--
-- Implements: PRD §3.1 ("Payroll — Owner: Full, Accountant: Prepare only"),
-- FR-8.8. Closes a security review finding.
-- ============================================================================

-- The policy written in 0013 granted `employees` writes to owner AND accountant,
-- on the reading that an accountant who prepares payroll needs to maintain the
-- employee list. That is wider than the PRD allows and wider than the app
-- assumes: `canEditEmployees` in features/payroll/types.ts is owner-only, so the
-- UI never offered the accountant these controls — but RLS is the enforcement
-- layer, and it was admitting writes the UI merely declined to show.
--
-- The gap mattered because of what the table holds. `employees` carries national
-- ID, KRA PIN, NSSF and SHIF numbers, phone and `payment_details` — personal
-- data under the Data Protection Act 2019, and the bank or M-Pesa destination
-- every salary is paid to. An accountant credential calling PostgREST directly
-- could have rewritten where an employee's pay lands, with nothing in the app
-- surfacing it.
--
-- "Prepare only" does not require editing the employee master record. Preparing
-- a run means inserting `payroll_runs` and `payroll_items`, which the accountant
-- keeps (payroll_runs_insert, payroll_runs_update while draft, and the
-- payroll_items policies from 0013). `employees_select` is likewise unchanged:
-- the accountant still reads every employee, which is what preparation needs.
--
-- Reversible: if the client confirms the accountant should maintain employee
-- records (PRD §12 leaves FR-8.8 as "[FILL IN: confirm extent]"), restore the
-- two-role list here and widen `canEditEmployees` to match. Record the decision
-- in docs/PROGRESS.md either way.

drop policy if exists employees_write on public.employees;

create policy employees_write on public.employees
  for all to authenticated
  using (app.is_owner())
  with check (app.is_owner());

comment on table public.employees is
  'Personal data under the Data Protection Act 2019. Readable by owner, manager and accountant; writable by the owner alone (PRD §3.1, FR-8.8, migration 0018).';
