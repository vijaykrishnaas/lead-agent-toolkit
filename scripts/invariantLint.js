#!/usr/bin/env node
// Mechanically enforces CLAUDE.md's hard invariants 2 and 3 against a commit range:
// (a) no existing TASKS.md task line, PROGRESS.md line, or SKILL_CHANGELOG.md line may
//     be removed (reordering is fine; deletion is not);
// (b) a diff touching CLAUDE.md, .claude/skills/**, or that substantively changes
//     TASKS.md's backlog (an added task, edited task wording, or reordering) must add
//     at least one non-blank SKILL_CHANGELOG.md line in the same diff. Marking an
//     existing task [DONE]/[BLOCKED: ...] in place, with wording and order otherwise
//     unchanged, is exempt from this — CLAUDE.md's own invariant 3 names "backlog
//     order" (not status) as the self-modification category, and this exemption
//     matches ~10 real prior commits' explicit, repeated precedent in
//     SKILL_CHANGELOG.md (e.g. "this run only marked an existing TASKS.md item [DONE]
//     ... not skills, CLAUDE.md, or backlog order/content").
const { execFileSync } = require('child_process');

const TASKS_FILE = 'TASKS.md';
const PROGRESS_FILE = 'PROGRESS.md';
const CHANGELOG_FILE = 'SKILL_CHANGELOG.md';
const CLAUDE_FILE = 'CLAUDE.md';
const SKILLS_DIR_PREFIX = '.claude/skills/';

const TASK_LINE_NUMBER = /^(\d+)\.\s/;
const TASK_LINE = /^(\d+)\.\s*(?:\[[^\]]*\]\s*)?(.*)$/;

function splitRange(range) {
  const sepIndex = range.indexOf('..');
  if (sepIndex === -1) {
    throw new Error(`Invalid range "${range}": expected "<base>..<head>".`);
  }
  return { base: range.slice(0, sepIndex), head: range.slice(sepIndex + 2) };
}

function showFile(execGit, ref, filePath) {
  try {
    return execGit(['show', `${ref}:${filePath}`]);
  } catch (err) {
    return null; // file didn't exist at that ref
  }
}

function changedFiles(execGit, base, head) {
  const output = execGit(['diff', '--name-only', `${base}..${head}`]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function lineCounts(content, filterFn) {
  const counts = new Map();
  if (content === null) return counts;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    if (filterFn && !filterFn(line)) continue;
    counts.set(line, (counts.get(line) || 0) + 1);
  }
  return counts;
}

function findRemovedLines(baseContent, headContent, filterFn) {
  const baseCounts = lineCounts(baseContent, filterFn);
  const headCounts = lineCounts(headContent, filterFn);
  const removed = [];
  for (const [line, baseCount] of baseCounts) {
    if ((headCounts.get(line) || 0) < baseCount) removed.push(line);
  }
  return removed;
}

function hasAddedLine(baseContent, headContent, filterFn) {
  const baseCounts = lineCounts(baseContent, filterFn);
  const headCounts = lineCounts(headContent, filterFn);
  for (const [line, headCount] of headCounts) {
    if (headCount > (baseCounts.get(line) || 0)) return true;
  }
  return false;
}

function taskNumbers(content) {
  const numbers = new Set();
  if (content === null) return numbers;
  for (const rawLine of content.split('\n')) {
    const match = TASK_LINE_NUMBER.exec(rawLine);
    if (match) numbers.add(match[1]);
  }
  return numbers;
}

function parseTasks(content) {
  const tasks = [];
  if (content === null) return tasks;
  for (const rawLine of content.split('\n')) {
    const match = TASK_LINE.exec(rawLine.trimEnd());
    if (match) tasks.push({ number: match[1], text: match[2] });
  }
  return tasks;
}

// True if TASKS.md changed in a way beyond marking an existing task's status tag
// in place: a task added, a task's wording edited, or the relative order of tasks
// changed. False if only bracket-tag content (e.g. "[DONE]") changed.
function tasksChangedSubstantively(baseContent, headContent) {
  const baseTasks = parseTasks(baseContent);
  const headTasks = parseTasks(headContent);
  const headTextByNumber = new Map(headTasks.map((task) => [task.number, task.text]));
  const baseNumbers = new Set(baseTasks.map((task) => task.number));
  const headNumbers = new Set(headTasks.map((task) => task.number));

  for (const { number, text } of baseTasks) {
    if (headTextByNumber.has(number) && headTextByNumber.get(number) !== text) {
      return true; // wording edited
    }
  }
  for (const number of headNumbers) {
    if (!baseNumbers.has(number)) return true; // new task added
  }

  const commonBaseOrder = baseTasks.map((task) => task.number).filter((n) => headNumbers.has(n));
  const commonHeadOrder = headTasks.map((task) => task.number).filter((n) => baseNumbers.has(n));
  if (commonBaseOrder.join(',') !== commonHeadOrder.join(',')) return true; // reordered

  return false;
}

function lintTasksFile(execGit, base, head) {
  const baseNumbers = taskNumbers(showFile(execGit, base, TASKS_FILE));
  const headNumbers = taskNumbers(showFile(execGit, head, TASKS_FILE));
  const violations = [];
  for (const number of baseNumbers) {
    if (!headNumbers.has(number)) {
      violations.push(`${TASKS_FILE}: existing task ${number}. was removed.`);
    }
  }
  return violations;
}

function lintHistoryFile(execGit, base, head, filePath) {
  const baseContent = showFile(execGit, base, filePath);
  if (baseContent === null) return [];
  const headContent = showFile(execGit, head, filePath);
  const removed = findRemovedLines(baseContent, headContent, (line) => line.trim().length > 0);
  return removed.map((line) => `${filePath}: history content removed: "${line}"`);
}

function lintChangelogAddition(execGit, base, head, files) {
  const claudeOrSkillsChanged = files.some(
    (file) => file === CLAUDE_FILE || file.startsWith(SKILLS_DIR_PREFIX)
  );
  const tasksSubstantivelyChanged =
    files.includes(TASKS_FILE) &&
    tasksChangedSubstantively(showFile(execGit, base, TASKS_FILE), showFile(execGit, head, TASKS_FILE));

  if (!claudeOrSkillsChanged && !tasksSubstantivelyChanged) return [];
  const baseContent = showFile(execGit, base, CHANGELOG_FILE);
  const headContent = showFile(execGit, head, CHANGELOG_FILE);
  const added = hasAddedLine(baseContent, headContent, (line) => line.trim().length > 0);
  if (added) return [];
  return [
    `${CLAUDE_FILE}, ${TASKS_FILE}, or ${SKILLS_DIR_PREFIX}* changed without a ${CHANGELOG_FILE} addition in the same diff.`,
  ];
}

function lintInvariants({ range, execGit }) {
  const { base, head } = splitRange(range);
  const files = changedFiles(execGit, base, head);
  const violations = [];

  if (files.includes(TASKS_FILE)) {
    violations.push(...lintTasksFile(execGit, base, head));
  }
  if (files.includes(PROGRESS_FILE)) {
    violations.push(...lintHistoryFile(execGit, base, head, PROGRESS_FILE));
  }
  if (files.includes(CHANGELOG_FILE)) {
    violations.push(...lintHistoryFile(execGit, base, head, CHANGELOG_FILE));
  }
  violations.push(...lintChangelogAddition(execGit, base, head, files));

  return violations;
}

function main() {
  const range = process.argv[2];
  if (!range) {
    console.error('Usage: node scripts/invariantLint.js <base>..<head>');
    process.exit(2);
  }
  const execGit = (gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' });

  let violations;
  try {
    violations = lintInvariants({ range, execGit });
  } catch (err) {
    console.error(`invariantLint failed: ${err.message}`);
    process.exit(2);
  }

  if (violations.length > 0) {
    console.error('Hard invariant violations found:');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log('Invariant lint passed: no violations found.');
}

if (require.main === module) {
  main();
}

module.exports = {
  lintInvariants,
  splitRange,
  taskNumbers,
  parseTasks,
  tasksChangedSubstantively,
  findRemovedLines,
  hasAddedLine,
};
