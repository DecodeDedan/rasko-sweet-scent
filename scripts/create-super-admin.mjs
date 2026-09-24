#!/usr/bin/env node
// Creates the first account: an owner holding the super admin flag
// (migration 20260924000100). Every later account is invited from the app's
// Users screen by an owner, so this runs once per Supabase project.
//
//   SUPABASE_SERVICE_ROLE_KEY=... pnpm admin:create
//
// The service role key is taken from the environment for this one command and
// never written anywhere. It must not go in .env: that file feeds the app
// bundle, and the key bypasses every RLS policy (PRD §7). SUPABASE_URL is read
// from the root .env, so the account lands in the project the app talks to.
//
// The password is typed here with echo off and sent straight to Supabase Auth.
// Nothing is printed or stored.
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const MIN_PASSWORD_LENGTH = 8 // supabase/config.toml minimum_password_length
const REQUEST_TIMEOUT_MS = 15_000

const rootEnv = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

function fail(message) {
  process.stderr.write(`\n${message}\n`)
  process.exit(1)
}

const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url) fail('SUPABASE_URL is not set. See .env.example.')
if (!serviceKey) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY is not set. Pass it for this command only:\n' +
      '  local:  SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY) pnpm admin:create\n' +
      '  hosted: copy it from Dashboard > Project Settings > API keys.',
  )
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

// Reads a line with echo off. readline has no hidden mode, and muting its
// output breaks its redraws, so this reads the raw keystrokes itself.
function askHidden(question) {
  if (!process.stdin.isTTY)
    fail('Run this in an interactive terminal so the password stays hidden.')
  return new Promise((resolve) => {
    process.stdout.write(question)
    const input = process.stdin
    let value = ''
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          input.setRawMode(false)
          input.pause()
          input.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          input.setRawMode(false)
          fail('Cancelled.')
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    input.on('data', onData)
  })
}

async function call(path, body) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { msg: text }
  }
  return { ok: response.ok, status: response.status, body: parsed }
}

async function removeAuthUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

async function main() {
  process.stdout.write(`Creating the super admin on ${url}\n\n`)

  const fullName = (await ask('Full name: ')).trim()
  if (!fullName) fail('Enter a full name.')

  const email = (await ask('Email: ')).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.')

  const password = await askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `)
  if (password.length < MIN_PASSWORD_LENGTH) fail(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  const confirmation = await askHidden('Confirm password: ')
  if (password !== confirmation) fail('The two passwords do not match.')

  // email_confirm: the person running this owns the address and the service
  // key; there is nobody else to prove it to.
  const created = await call('/auth/v1/admin/users', { email, password, email_confirm: true })
  if (!created.ok) {
    const detail = created.body?.msg ?? created.body?.message ?? `HTTP ${created.status}`
    if (created.status === 422 && /already/i.test(detail)) {
      fail(
        `${email} already has an account. To make it the super admin, run in the SQL editor:\n` +
          `  update public.profiles set role = 'owner', is_super_admin = true\n` +
          `   where email = '${email}';`,
      )
    }
    fail(`Supabase Auth refused the account: ${detail}`)
  }
  const userId = created.body?.id
  if (typeof userId !== 'string') fail('Supabase Auth did not return the new account id.')

  // Written with the service key, so the profile trigger's "no JWT" path
  // applies: the only way the flag can be granted.
  const profile = await call('/rest/v1/profiles', {
    id: userId,
    full_name: fullName,
    email,
    role: 'owner',
    is_active: true,
    must_change_password: false,
    is_super_admin: true,
  })
  if (!profile.ok) {
    // An auth user with no profile can sign in and then see nothing.
    await removeAuthUser(userId)
    fail(
      `The profile could not be written, so the account was removed: ${profile.body?.message ?? profile.status}`,
    )
  }

  process.stdout.write(`\nDone. ${fullName} <${email}> is the owner and super admin.\n`)
  process.stdout.write('Sign in to the app with that email and password.\n')
}

main().catch((error) => fail(`Could not reach Supabase: ${error.message}`))
