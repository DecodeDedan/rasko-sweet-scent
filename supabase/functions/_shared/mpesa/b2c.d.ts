// Types for b2c.js. The shared payout rules it re-exports are typed in
// ../payouts/rules.d.ts; Deno reads the JSDoc instead.
export {
  B2C_MAX_SHILLINGS,
  B2C_MIN_SHILLINGS,
  payoutAmount,
  payoutBlocker,
  toMsisdn,
} from '../payouts/rules.js'
