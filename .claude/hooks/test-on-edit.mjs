// Claude Code hook (PostToolUse on Edit/Write): after a file under src/ or tests/ was changed,
// run the test suite. Edits to docs, README, CI files etc. are ignored, so they stay instant.
//
// Exit codes: 0 = nothing to do / tests passed (silent); 2 = tests failed, and the output on
// stderr is shown to Claude so it can fix the problem.
import { spawnSync } from 'node:child_process'

let input = ''
for await (const chunk of process.stdin) input += chunk

let file = ''
try {
  file = JSON.parse(input).tool_input?.file_path ?? ''
} catch {
  process.exit(0) // not the JSON we expect: do nothing rather than break the session
}
if (!/[\\/](src|tests)[\\/]/.test(file)) process.exit(0)

const result = spawnSync('npm test --silent', { encoding: 'utf8', shell: true })
if (result.status !== 0) {
  process.stderr.write(`npm test failed after editing ${file}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  process.exit(2)
}
