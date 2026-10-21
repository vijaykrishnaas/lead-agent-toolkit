const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, buildEntry, parseLog, idleStreak, main } = require('../../scripts/runLog');

const NOW = new Date('2026-10-20T18:05:00.000Z');

function tmpLog(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runlog-'));
  const file = path.join(dir, 'runs.jsonl');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

describe('parseArgs', () => {
  it('parses value flags', () => {
    expect(parseArgs(['--trigger', 'builder', '--outcome', 'noop', '--summary', 'nothing'])).toEqual({
      trigger: 'builder',
      outcome: 'noop',
      summary: 'nothing',
    });
  });

  it('errors loudly when a value flag is the last token (guideline 7)', () => {
    expect(() => parseArgs(['--trigger', 'builder', '--summary'])).toThrow('Missing value for --summary');
  });

  it('errors when a value flag is followed by another flag', () => {
    expect(() => parseArgs(['--task', '--outcome', 'done'])).toThrow('Missing value for --task');
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--bogus', 'x'])).toThrow('Unknown argument: --bogus');
  });
});

describe('parseArgs, values that look like flags', () => {
  it('accepts a value starting with -- when it is not a known flag name', () => {
    expect(parseArgs(['--summary', '--fix: foo', '--tests', 'green'])).toEqual({ summary: '--fix: foo', tests: 'green' });
  });
});

describe('buildEntry', () => {
  it('builds a normalized entry with defaults', () => {
    expect(buildEntry({ trigger: 'reviewer', outcome: 'noop', summary: ' idle ' }, NOW)).toEqual({
      ts: '2026-10-20T18:05:00.000Z',
      trigger: 'reviewer',
      outcome: 'noop',
      task: null,
      tests: 'skipped',
      sha: null,
      summary: 'idle',
    });
  });

  it.each([
    [{ trigger: 'cron', outcome: 'done', summary: 's' }, '--trigger'],
    [{ trigger: 'builder', outcome: 'ok', summary: 's' }, '--outcome'],
    [{ trigger: 'builder', outcome: 'done', tests: 'yes', summary: 's' }, '--tests'],
    [{ trigger: 'builder', outcome: 'done', summary: '   ' }, '--summary'],
  ])('rejects invalid input %#', (opts, flag) => {
    expect(() => buildEntry(opts, NOW)).toThrow(flag);
  });
});

describe('idleStreak', () => {
  const e = (outcome) => ({ outcome });

  it('is 0 for an empty log', () => {
    expect(idleStreak([])).toBe(0);
  });

  it('counts only trailing consecutive noops', () => {
    expect(idleStreak([e('noop'), e('done'), e('noop'), e('noop')])).toBe(2);
  });

  it('is reset by a paused entry so re-enabled triggers start fresh', () => {
    expect(idleStreak([e('noop'), e('noop'), e('noop'), e('paused')])).toBe(0);
  });
});

describe('parseLog, non-object lines', () => {
  it('rejects a valid-JSON line that is not an object, naming the line', () => {
    expect(() => parseLog('{"outcome":"noop"}\nnull\n')).toThrow('line 2');
  });
});

describe('parseLog', () => {
  it('skips blank lines', () => {
    expect(parseLog('{"outcome":"noop"}\n\n{"outcome":"done"}\n')).toHaveLength(2);
  });

  it('reports the offending line number for malformed JSON', () => {
    expect(() => parseLog('{"outcome":"noop"}\nnot json\n')).toThrow('line 2');
  });
});

describe('main', () => {
  it('appends one JSON line per call, creating the file if missing', () => {
    const file = tmpLog();
    main(['append', '--trigger', 'builder', '--outcome', 'noop', '--summary', 'a'], file);
    main(['append', '--trigger', 'reviewer', '--outcome', 'noop', '--summary', 'b'], file);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).summary)).toEqual(['a', 'b']);
    expect(main(['idle-streak'], file)).toBe('2');
  });

  it('does not merge onto an existing last line that lacks a trailing newline', () => {
    const file = tmpLog('{"outcome":"done"}');
    main(['append', '--trigger', 'builder', '--outcome', 'noop', '--summary', 'a'], file);
    expect(parseLog(fs.readFileSync(file, 'utf8'))).toHaveLength(2);
  });

  it('reports 0 idle streak when the log does not exist', () => {
    expect(main(['idle-streak'], path.join(os.tmpdir(), 'does-not-exist-runs.jsonl'))).toBe('0');
  });

  it('rejects unknown commands', () => {
    expect(() => main(['delete'], tmpLog())).toThrow('Usage');
  });
});
