/**
 * vCard and CSV contact-import parsers (spec 10 item 5).
 *
 * Pure: no Supabase client, no fetch, no process.env
 * (docs/CONVENTIONS.md#pure-core-server-edge). Hand-rolled, not a new
 * dependency -- the same call lib/scraping/ics.ts already made for RFC 5545:
 * both formats are simple, well-documented text grammars, and every mobile
 * Contacts app can export a vCard, with CSV as the common spreadsheet
 * fallback (see docs/specs/10-crm.md's drafting decisions for why no Contact
 * Picker API or Web Share Target is relied on instead).
 *
 * Never guesses: a block/row with no name is skipped with a warning naming
 * its position, never silently dropped and never invented (CLAUDE.md).
 */

export type ParsedContact = {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** From vCard's UID -- lib/schemas/crm.ts's contacts.phone_contact_id.
   * CSV has no equivalent column, so this is always null there. */
  phoneContactId: string | null;
};

export type ParseResult = {
  contacts: ParsedContact[];
  warnings: string[];
};

/** The same `lower(btrim(name))` shape communities_user_name_key/nameKey
 * (lib/discovery/research.ts) establish, kept local rather than imported --
 * contacts has no unique name index and this is only for the review screen's
 * likely-duplicate flag (item 6), a different domain than discovery merging. */
export function contactNameKey(name: string): string {
  return name.trim().toLowerCase();
}

// -- vCard --------------------------------------------------------------------

/**
 * RFC 6350 section 3.2, the same folding rule RFC 5545 uses (ics.ts's own
 * unfold): a line is folded by inserting a CRLF followed by a single space or
 * tab, removed with no space inserted -- the fold marker is not content.
 */
function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }

  return lines;
}

type VCardProperty = { name: string; value: string };

/** "NAME;PARAM=VAL:VALUE" -- split at the first colon, params ignored (this
 * parser only reads FN/TEL/EMAIL/NOTE/UID's plain values). */
function parseVCardProperty(line: string): VCardProperty | null {
  const colonAt = line.indexOf(":");
  if (colonAt === -1) return null;
  const head = line.slice(0, colonAt);
  const value = line.slice(colonAt + 1);
  const name = head.split(";")[0]?.trim().toUpperCase();
  if (!name) return null;
  return { name, value };
}

/** RFC 6350 section 3.4: TEXT escape sequences, same set RFC 5545 uses. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseVCardBlock(lines: string[]): { name: string; found: boolean; contact: ParsedContact | null } {
  const props: VCardProperty[] = [];
  for (const line of lines) {
    const prop = parseVCardProperty(line);
    if (prop) props.push(prop);
  }

  const find = (name: string) => props.find((prop) => prop.name === name) ?? null;

  const fn = find("FN");
  if (!fn || !fn.value.trim()) return { name: "", found: false, contact: null };

  const tel = find("TEL");
  const email = find("EMAIL");
  const note = find("NOTE");
  const uid = find("UID");

  return {
    name: unescapeText(fn.value),
    found: true,
    contact: {
      name: unescapeText(fn.value),
      phone: tel ? unescapeText(tel.value) : null,
      email: email ? unescapeText(email.value) : null,
      notes: note ? unescapeText(note.value) : null,
      phoneContactId: uid ? unescapeText(uid.value) : null,
    },
  };
}

/**
 * Reads vCard 3.0/4.0 BEGIN:VCARD/END:VCARD blocks. A block with no FN (or a
 * blank one) is skipped with a warning naming its position among the blocks
 * in the file (1-indexed) -- never guessed at.
 */
export function parseVCard(text: string): ParseResult {
  const lines = unfold(text);
  const contacts: ParsedContact[] = [];
  const warnings: string[] = [];

  let block: string[] | null = null;
  let blockIndex = 0;

  const closeBlock = () => {
    if (!block) return;
    blockIndex += 1;
    const result = parseVCardBlock(block);
    if (result.found && result.contact) {
      contacts.push(result.contact);
    } else {
      warnings.push(`vCard block ${blockIndex} has no FN (name) and was skipped.`);
    }
    block = null;
  };

  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line)) {
      closeBlock(); // an unterminated previous block is judged as-is
      block = [];
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      closeBlock();
      continue;
    }
    if (block) block.push(line);
  }
  closeBlock();

  return { contacts, warnings };
}

// -- CSV ------------------------------------------------------------------------

/** Splits one CSV line on commas, honoring double-quoted fields (with ""
 * as an escaped quote) -- enough for a spreadsheet export, not a full RFC
 * 4180 implementation. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

const RECOGNIZED_COLUMNS = ["name", "phone", "email", "notes"] as const;

/**
 * Reads a header row matched case-insensitively for `name` (required -- a
 * missing `name` column is a parse error surfaced up front, not a guess),
 * `phone`/`email`/`notes` (all optional); unrecognized columns are ignored.
 * A data row with a blank name is skipped with a warning naming its line
 * number (1-indexed, counting the header as line 1).
 */
export function parseCsv(text: string): ParseResult {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error("This CSV file is empty.");
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const columnIndex: Partial<Record<(typeof RECOGNIZED_COLUMNS)[number], number>> = {};
  for (const column of RECOGNIZED_COLUMNS) {
    const at = header.indexOf(column);
    if (at !== -1) columnIndex[column] = at;
  }

  if (columnIndex.name === undefined) {
    throw new Error('This CSV file has no "name" column.');
  }
  const nameIndex = columnIndex.name;

  const contacts: ParsedContact[] = [];
  const warnings: string[] = [];

  for (let row = 1; row < lines.length; row++) {
    const cells = splitCsvLine(lines[row]);
    const name = (cells[nameIndex] ?? "").trim();

    if (!name) {
      warnings.push(`Line ${row + 1} has a blank name and was skipped.`);
      continue;
    }

    const at = (key: (typeof RECOGNIZED_COLUMNS)[number]): string | null => {
      const index = columnIndex[key];
      if (index === undefined) return null;
      return cells[index]?.trim() || null;
    };

    contacts.push({
      name,
      phone: at("phone"),
      email: at("email"),
      notes: at("notes"),
      phoneContactId: null,
    });
  }

  return { contacts, warnings };
}
