import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  buildBackupSql,
  insertStatements,
  sqlLiteral,
} from "@/lib/backup";

describe("backup SQL generation", () => {
  it("renders literals for every type the schema holds", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
    expect(sqlLiteral(500)).toBe("500");
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral(false)).toBe("FALSE");
    expect(sqlLiteral("plain")).toBe("'plain'");
    expect(sqlLiteral([3, 7, 1, 9, 0, 5, 2, 8, 4, 6])).toBe(
      "'{3,7,1,9,0,5,2,8,4,6}'",
    );
    expect(sqlLiteral({ game_no: 1, note: "it's fine" })).toBe(
      `'{"game_no":1,"note":"it''s fine"}'`,
    );
  });

  it("escapes quotes so names and notes survive the round trip", () => {
    expect(sqlLiteral("Breeze (Agnes)")).toBe("'Breeze (Agnes)'");
    expect(sqlLiteral("Ant it's Scro")).toBe("'Ant it''s Scro'");
    expect(sqlLiteral("line1\nline2")).toBe("'line1\nline2'");
  });

  it("chunks inserts and quotes column names", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      block_number: i + 1,
      status: "available",
      notes: null,
    }));
    const stmts = insertStatements("blocks", rows, 50);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('insert into blocks ("block_number", "status", "notes")');
    expect(stmts[0]).toContain("(1, 'available', NULL)");
    expect(stmts[2]).toContain("(120, 'available', NULL)");
  });

  it("builds a single-transaction, trigger-suspended restore file", () => {
    const data = Object.fromEntries(
      BACKUP_TABLES.map((t) => [t, [] as Record<string, unknown>[]]),
    ) as Parameters<typeof buildBackupSql>[0];
    data.config = [{ id: 1, price_per_block_cents: 50000 }];
    const sql = buildBackupSql(data, "2026-08-25T12:00:00.000Z");
    expect(sql).toContain("begin;");
    expect(sql).toContain("set local session_replication_role = replica;");
    expect(sql).toContain(
      "truncate table audit_log, payouts, payments, blocks, games, participants, config cascade;",
    );
    expect(sql).toContain('insert into config ("id", "price_per_block_cents")');
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    // The instructions travel with the file.
    expect(sql).toContain("RESTORE");
  });

  it("refuses array element types the schema never produces", () => {
    expect(() => sqlLiteral(["a", "b"])).toThrow();
  });
});
