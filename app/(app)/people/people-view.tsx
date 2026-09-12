"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";

import {
  archiveContact,
  createContact,
  importContacts,
  logInteraction,
  previewImport,
  restoreContact,
  updateContact,
  type ContactPatch,
  type CreateContactInput,
  type ImportPreviewRow,
} from "./actions";
import type { ContactCard, MeetableEvent, PeopleData } from "./data";
import {
  composeTemplate,
  INTERACTION_KIND_LABELS,
  LOGGABLE_INTERACTION_KINDS,
  matchesQuery,
  mostRecentInteraction,
  partitionByStatus,
  tally,
  type ActionResult,
  type LoggableInteractionKind,
} from "./view";
import type { InteractionRow } from "@/lib/schemas";

/**
 * The People page (spec 10 items 1-4, 6-7): a searchable, addable,
 * importable contact list, each contact expanding into its full interaction
 * history, a log-interaction form, and the message-compose panel.
 */
export function PeopleView({ data, timezone }: { data: PeopleData; timezone: string }) {
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const filtered = useMemo(
    () => data.contacts.filter((contact) => matchesQuery(contact, query)),
    [data.contacts, query],
  );
  const { active, archived } = partitionByStatus(filtered);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">People</h1>
        <p className="text-sm opacity-70">
          The people you&apos;ve met along the way — who they are, where you met
          them, and how often you&apos;ve stayed in touch.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex-1">
            <span className="sr-only">Search contacts</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, email, notes, met at…"
              className="w-full min-w-[220px] rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowAdd((was) => !was)}
            className="rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            {showAdd ? "Cancel" : "Add contact"}
          </button>
          <button
            type="button"
            onClick={() => setShowImport((was) => !was)}
            className="rounded border border-current px-3 py-1.5 text-xs"
          >
            {showImport ? "Cancel import" : "Import vCard/CSV"}
          </button>
        </div>
      </header>

      {showAdd ? (
        <AddContactForm
          communities={data.communities}
          meetableEvents={data.meetableEvents}
          onDone={() => setShowAdd(false)}
        />
      ) : null}

      {showImport ? <ImportPanel /> : null}

      <section className="flex flex-col gap-3">
        {active.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            {data.contacts.length === 0
              ? "No contacts yet. Add one, or import from a vCard/CSV export."
              : "No contacts match your search."}
          </p>
        ) : (
          active.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              interactions={data.interactionsByContact.get(contact.id) ?? []}
              communities={data.communities}
              meetableEvents={data.meetableEvents}
              timezone={timezone}
            />
          ))
        )}
      </section>

      {archived.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs opacity-70">{archived.length} archived</summary>
          <div className="mt-2 flex flex-col gap-3">
            {archived.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                interactions={data.interactionsByContact.get(contact.id) ?? []}
                communities={data.communities}
                meetableEvents={data.meetableEvents}
                timezone={timezone}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// -- Add contact (item 2) --------------------------------------------------------

function AddContactForm({
  communities,
  meetableEvents,
  onDone,
}: {
  communities: PeopleData["communities"];
  meetableEvents: MeetableEvent[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [eventId, setEventId] = useState("");
  const [metOn, setMetOn] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setResult({ ok: false, error: "A name is required." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const input: CreateContactInput = {
        name: name.trim(),
        phone: phone || null,
        email: email || null,
        met_at_community_id: communityId || null,
        met_at_event_id: eventId || null,
        met_on: metOn || null,
        notes: notes || null,
      };
      const outcome = await createContact(input);
      setResult(outcome);
      if (outcome.ok) {
        setName("");
        setPhone("");
        setEmail("");
        setCommunityId("");
        setEventId("");
        setMetOn("");
        setNotes("");
        onDone();
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15"
    >
      <h2 className="text-sm font-medium">Add a contact</h2>
      <label className="flex flex-col gap-1 text-xs">
        <span className="opacity-70">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">Phone</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">Met at community</span>
          <select
            value={communityId}
            onChange={(event) => setCommunityId(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            <option value="">(none)</option>
            {communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">Met at event</span>
          <select
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            <option value="">(none)</option>
            {meetableEvents.map((meetable) => (
              <option key={meetable.eventId} value={meetable.eventId}>
                {meetable.title} ({meetable.communityName})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-70">Met on</span>
          <input
            type="date"
            value={metOn}
            onChange={(event) => setMetOn(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="opacity-70">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
      >
        {pending ? "Saving…" : "Add contact"}
      </button>
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}

// -- A contact card, editable, with tally, history, log form and compose (items 2-4) --

type SavableField =
  | "name"
  | "phone"
  | "email"
  | "notes"
  | "met_at_community_id"
  | "met_at_event_id"
  | "met_on";

function ContactRow({
  contact,
  interactions,
  communities,
  meetableEvents,
  timezone,
}: {
  contact: ContactCard;
  interactions: InteractionRow[];
  communities: PeopleData["communities"];
  meetableEvents: MeetableEvent[];
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<SavableField | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  /** Every field here autosaves on its own trigger, the same "✓ Saved" badge
   * precedent as communities-view.tsx's Card (docs/CONVENTIONS.md). */
  function save(patch: ContactPatch, field: SavableField) {
    setError(null);
    startTransition(async () => {
      const result = await updateContact(contact.id, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      setSavedField(field);
      savedTimeoutRef.current = setTimeout(() => setSavedField(null), 2000);
    });
  }

  const stats = tally(interactions);
  const recent = mostRecentInteraction(interactions);
  const isArchived = contact.status === "archived";

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex flex-wrap items-baseline justify-between gap-2 text-left"
      >
        <span className="font-medium">{contact.name}</span>
        <span className="text-xs opacity-70">
          {stats.total} interaction{stats.total === 1 ? "" : "s"}
          {recent ? ` · last ${new Date(recent).toLocaleDateString()}` : ""}
        </span>
      </button>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {contact.metAtCommunityName ? (
          <div>
            <dt className="inline font-medium">Met at: </dt>
            <dd className="inline">{contact.metAtCommunityName}</dd>
          </div>
        ) : null}
        {contact.metAtEventTitle ? (
          <div>
            <dt className="inline font-medium">Event: </dt>
            <dd className="inline">{contact.metAtEventTitle}</dd>
          </div>
        ) : null}
        {contact.met_on ? (
          <div>
            <dt className="inline font-medium">Since: </dt>
            <dd className="inline">{contact.met_on}</dd>
          </div>
        ) : null}
      </dl>

      {open ? (
        <div className="mt-2 flex flex-col gap-4 border-t border-black/10 pt-3 text-sm dark:border-white/15">
          <label className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-1.5 opacity-70">
              Name
              <SavedBadge show={savedField === "name"} />
            </span>
            <input
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name !== contact.name) save({ name: name.trim() }, "name");
              }}
              className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="flex items-center gap-1.5 opacity-70">
                Phone
                <SavedBadge show={savedField === "phone"} />
              </span>
              <input
                value={phone}
                disabled={pending}
                onChange={(event) => setPhone(event.target.value)}
                onBlur={() => {
                  if (phone !== (contact.phone ?? "")) save({ phone: phone || null }, "phone");
                }}
                className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="flex items-center gap-1.5 opacity-70">
                Email
                <SavedBadge show={savedField === "email"} />
              </span>
              <input
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => {
                  if (email !== (contact.email ?? "")) save({ email: email || null }, "email");
                }}
                className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="flex items-center gap-1.5 opacity-70">
                Met at community
                <SavedBadge show={savedField === "met_at_community_id"} />
              </span>
              <select
                value={contact.met_at_community_id ?? ""}
                disabled={pending}
                onChange={(event) =>
                  save({ met_at_community_id: event.target.value || null }, "met_at_community_id")
                }
                className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
              >
                <option value="">(none)</option>
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="flex items-center gap-1.5 opacity-70">
                Met at event
                <SavedBadge show={savedField === "met_at_event_id"} />
              </span>
              <select
                value={contact.met_at_event_id ?? ""}
                disabled={pending}
                onChange={(event) =>
                  save({ met_at_event_id: event.target.value || null }, "met_at_event_id")
                }
                className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
              >
                <option value="">(none)</option>
                {meetableEvents.map((meetable) => (
                  <option key={meetable.eventId} value={meetable.eventId}>
                    {meetable.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="flex items-center gap-1.5 opacity-70">
                Met on
                <SavedBadge show={savedField === "met_on"} />
              </span>
              <input
                type="date"
                value={contact.met_on ?? ""}
                disabled={pending}
                onChange={(event) => save({ met_on: event.target.value || null }, "met_on")}
                className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-1.5 opacity-70">
              Notes
              <SavedBadge show={savedField === "notes"} />
            </span>
            <textarea
              value={notes}
              disabled={pending}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== (contact.notes ?? "")) save({ notes: notes || null }, "notes");
              }}
              className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
            />
          </label>

          {error ? (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <InteractionHistory interactions={interactions} timezone={timezone} />
          <LogInteractionForm contactId={contact.id} meetableEvents={meetableEvents} />
          <MessagePanel contact={contact} />

          {isArchived ? (
            <ArchiveButton contactId={contact.id} label="Restore" action={restoreContact} />
          ) : (
            <ArchiveButton contactId={contact.id} label="Archive" action={archiveContact} />
          )}
        </div>
      ) : null}
    </article>
  );
}

/** A field autosaved with no separate Save button; the only signal a write
 * actually took, next to whichever field just wrote (communities-view.tsx's
 * precedent, docs/CONVENTIONS.md). */
function SavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span role="status" className="text-[10px] text-green-700 dark:text-green-400">
      ✓ Saved
    </span>
  );
}

function ArchiveButton({
  contactId,
  label,
  action,
}: {
  contactId: string;
  label: string;
  action: (contactId: string) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await action(contactId);
            if (!result.ok) setError(result.error);
          });
        }}
        className="self-start rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
      >
        {pending ? "Working…" : label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// -- Interaction history and logging (item 3) ------------------------------------

function InteractionHistory({
  interactions,
  timezone,
}: {
  interactions: InteractionRow[];
  timezone: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium opacity-70">History</h3>
      {interactions.length === 0 ? (
        <p className="text-xs opacity-60">No interactions logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs opacity-80">
          {interactions.map((interaction) => (
            <li key={interaction.id}>
              {INTERACTION_KIND_LABELS[interaction.kind]} —{" "}
              {new Date(interaction.occurred_at).toLocaleString("en-US", { timeZone: timezone })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LogInteractionForm({
  contactId,
  meetableEvents,
}: {
  contactId: string;
  meetableEvents: MeetableEvent[];
}) {
  const [kind, setKind] = useState<LoggableInteractionKind>("text");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventId, setEventId] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const occurredAt = new Date(`${date}T00:00:00Z`).toISOString();
      const outcome = await logInteraction(contactId, {
        kind,
        occurredAt,
        eventId: eventId || null,
      });
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-black/10 p-3 dark:border-white/15">
      <h3 className="text-xs font-medium opacity-70">Log an interaction</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Kind</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as LoggableInteractionKind)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            {LOGGABLE_INTERACTION_KINDS.map((one) => (
              <option key={one} value={one}>
                {INTERACTION_KIND_LABELS[one]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Event (optional)</span>
          <select
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            className="rounded border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
          >
            <option value="">(no event)</option>
            {meetableEvents.map((meetable) => (
              <option key={meetable.eventId} value={meetable.eventId}>
                {meetable.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "Logging…" : "Log"}
        </button>
      </div>
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? (
        <p role="status" className="text-xs opacity-70">
          Logged.
        </p>
      ) : null}
    </div>
  );
}

// -- Compose and confirm-send (item 4) -------------------------------------------

/**
 * sms:/mailto: links, never a send API (CLAUDE.md hard rule). "I sent this"
 * is a manual, undetected-by-design confirmation -- there is no way for this
 * page to know whether the native app the link opened actually sent
 * anything.
 */
function MessagePanel({ contact }: { contact: ContactCard }) {
  const [text, setText] = useState(() => composeTemplate(contact.name));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmSent() {
    setResult(null);
    startTransition(async () => setResult(await logInteraction(contact.id, { kind: "text" })));
  }

  const smsHref = contact.phone ? `sms:${contact.phone}?&body=${encodeURIComponent(text)}` : null;
  const mailtoHref = contact.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent("Hey!")}&body=${encodeURIComponent(text)}`
    : null;

  return (
    <div className="flex flex-col gap-2 rounded border border-black/10 p-3 dark:border-white/15">
      <h3 className="text-xs font-medium opacity-70">Message</h3>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
      />
      <div className="flex flex-wrap items-center gap-2">
        {smsHref ? (
          <a href={smsHref} className="rounded border border-current px-2 py-1 text-xs">
            Text
          </a>
        ) : null}
        {mailtoHref ? (
          <a href={mailtoHref} className="rounded border border-current px-2 py-1 text-xs">
            Email
          </a>
        ) : null}
        {!smsHref && !mailtoHref ? (
          <span className="text-xs opacity-60">Add a phone or email to message this contact.</span>
        ) : null}
        <button
          type="button"
          onClick={confirmSent}
          disabled={pending}
          className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "Logging…" : "✓ I sent this"}
        </button>
      </div>
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}

// -- vCard/CSV import (item 6) ----------------------------------------------------

function ImportPanel() {
  const [rows, setRows] = useState<ImportPreviewRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "vcard";
    setError(null);
    setResult(null);
    setRows(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      startTransition(async () => {
        const preview = await previewImport(text, format);
        if (!preview.ok) {
          setError(preview.error);
          return;
        }
        setRows(preview.rows);
        setWarnings(preview.warnings);
        setChecked(new Set(preview.rows.map((_, index) => index)));
      });
    };
    reader.readAsText(file);
  }

  function toggle(index: number) {
    setChecked((was) => {
      const next = new Set(was);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /**
   * Deliberately does not close the panel on success (unlike AddContactForm,
   * which has no confirmation message to show): closing it in the same tick
   * as setResult would unmount the "Imported N contacts" note before anyone
   * could see it, the same unmount-before-render class of bug specs 04/07/09
   * each found live once. The review checklist itself is cleared so the
   * panel becomes just the confirmation; the person closes it manually via
   * the header's "Cancel import" toggle whenever they're done reading it.
   */
  function confirmImport() {
    if (!rows) return;
    const selected = rows.filter((_, index) => checked.has(index));
    setResult(null);
    startTransition(async () => {
      const outcome = await importContacts(selected);
      setResult(outcome);
      if (outcome.ok) setRows(null);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      <h2 className="text-sm font-medium">Import contacts</h2>
      <label className="flex flex-col gap-1 text-xs">
        <span className="opacity-70">A .vcf (vCard) or .csv file exported from your phone or a spreadsheet</span>
        <input type="file" accept=".vcf,.csv" onChange={onFile} className="text-xs" />
      </label>

      {error ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {rows ? (
        <div className="flex flex-col gap-2">
          {warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {rows.length === 0 ? (
            <p className="text-xs opacity-70">Nothing parsed from that file.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1 text-sm">
                {rows.map((row, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked.has(index)}
                      onChange={() => toggle(index)}
                      aria-label={`Import ${row.name}`}
                    />
                    <span>{row.name}</span>
                    {row.phone ? <span className="text-xs opacity-60">{row.phone}</span> : null}
                    {row.email ? <span className="text-xs opacity-60">{row.email}</span> : null}
                    {row.duplicate ? (
                      <span className="rounded border border-amber-500/40 px-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Likely duplicate
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={confirmImport}
                disabled={pending || checked.size === 0}
                className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
              >
                {pending ? "Importing…" : `Import ${checked.size} contact${checked.size === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
      {result?.ok && result.note ? (
        <p role="status" className="text-xs opacity-70">
          {result.note}
        </p>
      ) : null}
    </div>
  );
}
