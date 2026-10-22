const { parseAst } = require('../../src/utils/parseAst');

describe('parseAst', () => {
  it('parses a CommonJS script', () => {
    const ast = parseAst("const a = require('a');\nmodule.exports = a;\n");
    expect(ast.type).toBe('Program');
  });

  it('parses an ES module file with import/export instead of throwing', () => {
    const ast = parseAst("import express from 'express';\nexport const router = express.Router();\n");
    expect(ast.type).toBe('Program');
    expect(ast.body[0].type).toBe('ImportDeclaration');
  });

  it('still throws on genuinely invalid source', () => {
    expect(() => parseAst('const = ;')).toThrow();
  });
});
