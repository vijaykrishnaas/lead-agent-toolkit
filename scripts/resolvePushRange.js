#!/usr/bin/env node
// Resolves the diff range for CI's reviewer-dogfood step on a `push` event.
// `before` is the all-zero SHA on a branch's first push, and either SHA can
// be absent from a shallow/rewritten history on a force-push, so this falls
// back to `after`'s parent, then to git's empty-tree object, rather than
// failing the step outright.
const { execFileSync } = require('child_process');

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const ZERO_SHA = '0000000000000000000000000000000000000000';

function refExists(execGit, ref) {
  try {
    execGit(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (err) {
    return false;
  }
}

function resolvePushRange({ before, after, execGit }) {
  if (!after) throw new Error('resolvePushRange requires a non-empty "after" SHA.');
  if (before && before !== ZERO_SHA && refExists(execGit, `${before}^{commit}`)) {
    return `${before}..${after}`;
  }
  if (refExists(execGit, `${after}^`)) {
    return `${after}^..${after}`;
  }
  return `${EMPTY_TREE_SHA}..${after}`;
}

function main() {
  const execGit = (gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' });
  const range = resolvePushRange({
    before: process.env.PUSH_BEFORE_SHA || '',
    after: process.env.PUSH_AFTER_SHA || '',
    execGit,
  });
  process.stdout.write(range);
}

if (require.main === module) {
  main();
}

module.exports = { resolvePushRange };
