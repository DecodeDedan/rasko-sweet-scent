/**
 * Reports which business facts are still unconfirmed, and refuses the build if
 * a required one is missing.
 *
 * The site is deliberately built so that an unknown fact renders as nothing
 * rather than as a placeholder. That is the right behaviour for a visitor and
 * the wrong behaviour for whoever is maintaining the site, because a section
 * can quietly go missing and nobody notices. This is the counterweight: the
 * facts are invisible on the page and loud on the command line.
 *
 * Run directly:      pnpm --filter @rasko/website content
 * Runs on build:     see the `build` script in package.json
 *
 * Reads content/site.ts directly. Node 24 strips the type annotations, so
 * there is no build step and no chance of this checking a stale copy.
 */
import { REQUIRED_FACTS, site } from '../content/site.ts'

/** Walks the content tree and collects the dotted path of every null leaf. */
function findUnsetFacts(node, path = []) {
  if (node === null) return [path.join('.')]
  if (typeof node !== 'object') return []

  return Object.entries(node).flatMap(([key, value]) => findUnsetFacts(value, [...path, key]))
}

const unset = findUnsetFacts(site)
const required = REQUIRED_FACTS.filter((fact) => unset.includes(fact))
const optional = unset.filter((fact) => !REQUIRED_FACTS.includes(fact))

if (unset.length === 0) {
  console.log('Every business fact in content/site.ts is filled in.')
  process.exit(0)
}

if (optional.length > 0) {
  console.log(
    '\n%d fact%s still awaiting the client. The page omits each one rather than',
    optional.length,
    optional.length === 1 ? '' : 's',
  )
  console.log('inventing it, so the site reads correctly without them:\n')
  for (const fact of optional) console.log('    %s', fact)
}

if (required.length > 0) {
  console.error('\nThe site cannot be published without these:\n')
  for (const fact of required) console.error('    %s', fact)
  console.error('\nFill them in at apps/website/content/site.ts and build again.')
  console.error('Without a WhatsApp number the only call to action on the page')
  console.error('does nothing, which is worse than having no page.\n')
  process.exit(1)
}

console.log('\nNone of these block publishing.\n')
