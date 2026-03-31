import { describe, it, expect, beforeAll } from 'vitest';
import { createDialect, type SqlDialect } from '../dialect.js';

describe('SQL Dialect Helper', () => {
  describe('createDialect()', () => {
    it('creates sqlite dialect', () => {
      const d = createDialect('sqlite');
      expect(d.name).toBe('sqlite');
    });

    it('creates postgres dialect', () => {
      const d = createDialect('postgres');
      expect(d.name).toBe('postgres');
    });

    it('throws on unknown dialect', () => {
      expect(() => createDialect('mysql' as any)).toThrow('Unknown SQL dialect: mysql');
    });
  });

  describe('SQLite dialect', () => {
    let d: SqlDialect;

    beforeAll(() => {
      d = createDialect('sqlite');
    });

    it('autoId() returns INTEGER PRIMARY KEY AUTOINCREMENT', () => {
      expect(d.autoId()).toBe('INTEGER PRIMARY KEY AUTOINCREMENT');
    });

    it("now() returns datetime('now')", () => {
      expect(d.now()).toBe("datetime('now')");
    });

    it('boolean(true) returns 1', () => {
      expect(d.boolean(true)).toBe('1');
    });

    it('boolean(false) returns 0', () => {
      expect(d.boolean(false)).toBe('0');
    });

    it('textType() returns TEXT', () => {
      expect(d.textType()).toBe('TEXT');
    });

    it('realType() returns REAL', () => {
      expect(d.realType()).toBe('REAL');
    });

    it('intType() returns INTEGER', () => {
      expect(d.intType()).toBe('INTEGER');
    });

    it("defaultNow() returns DEFAULT (datetime('now'))", () => {
      expect(d.defaultNow()).toBe("DEFAULT (datetime('now'))");
    });
  });

  describe('PostgreSQL dialect', () => {
    let d: SqlDialect;

    beforeAll(() => {
      d = createDialect('postgres');
    });

    it('autoId() returns SERIAL PRIMARY KEY', () => {
      expect(d.autoId()).toBe('SERIAL PRIMARY KEY');
    });

    it('now() returns NOW()', () => {
      expect(d.now()).toBe('NOW()');
    });

    it('boolean(true) returns TRUE', () => {
      expect(d.boolean(true)).toBe('TRUE');
    });

    it('boolean(false) returns FALSE', () => {
      expect(d.boolean(false)).toBe('FALSE');
    });

    it('textType() returns TEXT', () => {
      expect(d.textType()).toBe('TEXT');
    });

    it('realType() returns DOUBLE PRECISION', () => {
      expect(d.realType()).toBe('DOUBLE PRECISION');
    });

    it('intType() returns INTEGER', () => {
      expect(d.intType()).toBe('INTEGER');
    });

    it('defaultNow() returns DEFAULT NOW()', () => {
      expect(d.defaultNow()).toBe('DEFAULT NOW()');
    });
  });

  describe('Generated SQL compatibility', () => {
    it('produces valid SQLite CREATE TABLE with autoId and defaultNow', () => {
      const d = createDialect('sqlite');
      const sql = `CREATE TABLE test (id ${d.autoId()}, name ${d.textType()} NOT NULL, created_at ${d.textType()} NOT NULL ${d.defaultNow()})`;
      expect(sql).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(sql).toContain("DEFAULT (datetime('now'))");
    });

    it('produces valid PostgreSQL CREATE TABLE with autoId and defaultNow', () => {
      const d = createDialect('postgres');
      const sql = `CREATE TABLE test (id ${d.autoId()}, name ${d.textType()} NOT NULL, created_at ${d.textType()} NOT NULL ${d.defaultNow()})`;
      expect(sql).toContain('SERIAL PRIMARY KEY');
      expect(sql).toContain('DEFAULT NOW()');
    });
  });
});
