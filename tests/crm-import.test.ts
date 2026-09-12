import { describe, expect, it } from "vitest";

import { contactNameKey, parseCsv, parseVCard } from "@/lib/crm/import";

/**
 * Spec 10 item 5. Pure text-format parsing, no fixture files -- the vCard/CSV
 * samples are small enough to inline, unlike tests/ics.test.ts's real-shaped
 * feeds.
 */

describe("contactNameKey", () => {
  it("trims and lowercases", () => {
    expect(contactNameKey("  Jane Doe  ")).toBe("jane doe");
    expect(contactNameKey("JANE DOE")).toBe("jane doe");
  });
});

describe("parseVCard", () => {
  it("parses a valid multi-contact vCard", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "TEL;TYPE=CELL:555-0100",
      "EMAIL:jane@example.com",
      "NOTE:Met at the barn dance",
      "UID:abc-123",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:John Smith",
      "TEL:555-0200",
      "END:VCARD",
    ].join("\r\n");

    const { contacts, warnings } = parseVCard(text);

    expect(warnings).toEqual([]);
    expect(contacts).toEqual([
      {
        name: "Jane Doe",
        phone: "555-0100",
        email: "jane@example.com",
        notes: "Met at the barn dance",
        phoneContactId: "abc-123",
      },
      {
        name: "John Smith",
        phone: "555-0200",
        email: null,
        notes: null,
        phoneContactId: null,
      },
    ]);
  });

  it("skips a block with no FN, naming its position, and keeps the valid ones around it", () => {
    const text = [
      "BEGIN:VCARD",
      "FN:Jane Doe",
      "END:VCARD",
      "BEGIN:VCARD",
      "TEL:555-0200",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:John Smith",
      "END:VCARD",
    ].join("\r\n");

    const { contacts, warnings } = parseVCard(text);

    expect(contacts.map((c) => c.name)).toEqual(["Jane Doe", "John Smith"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2/);
  });

  it("unfolds a folded continuation line back into one continuous value", () => {
    const text = [
      "BEGIN:VCARD",
      "FN:Jane Doe",
      "NOTE:This is a very long note that got fol",
      " ded onto a continuation line",
      "END:VCARD",
    ].join("\r\n");

    const { contacts, warnings } = parseVCard(text);

    expect(warnings).toEqual([]);
    expect(contacts[0].notes).toBe("This is a very long note that got folded onto a continuation line");
  });

  it("maps UID to phoneContactId", () => {
    const text = ["BEGIN:VCARD", "FN:Jane Doe", "UID:phone-uid-999", "END:VCARD"].join("\r\n");
    const { contacts } = parseVCard(text);
    expect(contacts[0].phoneContactId).toBe("phone-uid-999");
  });

  it("treats a blank FN the same as a missing one", () => {
    const text = ["BEGIN:VCARD", "FN:", "END:VCARD"].join("\r\n");
    const { contacts, warnings } = parseVCard(text);
    expect(contacts).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe("parseCsv", () => {
  it("parses a valid CSV with name, phone, email, notes", () => {
    const text = [
      "name,phone,email,notes",
      "Jane Doe,555-0100,jane@example.com,Met at the barn dance",
      "John Smith,555-0200,,",
    ].join("\n");

    const { contacts, warnings } = parseCsv(text);

    expect(warnings).toEqual([]);
    expect(contacts).toEqual([
      {
        name: "Jane Doe",
        phone: "555-0100",
        email: "jane@example.com",
        notes: "Met at the barn dance",
        phoneContactId: null,
      },
      {
        name: "John Smith",
        phone: "555-0200",
        email: null,
        notes: null,
        phoneContactId: null,
      },
    ]);
  });

  it("matches header columns case-insensitively and ignores unrecognized columns", () => {
    const text = ["Name,Extra,Email", "Jane Doe,ignored,jane@example.com"].join("\n");
    const { contacts, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(contacts).toEqual([
      { name: "Jane Doe", phone: null, email: "jane@example.com", notes: null, phoneContactId: null },
    ]);
  });

  it("rejects a CSV with no name column up front", () => {
    const text = ["phone,email", "555-0100,jane@example.com"].join("\n");
    expect(() => parseCsv(text)).toThrow(/name/i);
  });

  it("skips a row with a blank name, naming its line number, and keeps the valid ones", () => {
    const text = ["name,phone", "Jane Doe,555-0100", ",555-0200", "John Smith,555-0300"].join("\n");
    const { contacts, warnings } = parseCsv(text);
    expect(contacts.map((c) => c.name)).toEqual(["Jane Doe", "John Smith"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/3/);
  });

  it("handles a quoted field containing a comma", () => {
    const text = ['name,notes', 'Jane Doe,"Met at the dance, really enjoyed it"'].join("\n");
    const { contacts } = parseCsv(text);
    expect(contacts[0].notes).toBe("Met at the dance, really enjoyed it");
  });
});
