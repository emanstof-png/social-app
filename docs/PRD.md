# PRD — social-app (FROZEN)
Purpose: give a person a social life by systematically finding communities, attending, evaluating, and converting acquaintances into friends. Hand-guided web app; the user never has to remember what to ask a chatbot. All features below are required. Do not add features.

## 1. Assessment
1. Interview the user about hobbies; run a relevant personality assessment (DISC or others — the app looks through a catalogue of assessments and picks relevant ones).
2. Interview the user about desires and which social environments they want to move toward.
3. Every answer is written to storage as it is given (memory).
4. Generate an assessment: who this person is, their goals, desired activities.
5. Suggest additional activities that support those goals.
6. Goals combine long-term recurring communities and one-time events from various communities.
7. The app advises focusing on only a few communities at a time to grow friendships well.

## 2. Community gathering
1. For each selected activity (e.g., rucking, chosen because the person values discipline), find local organizations using a multi-round deep-research protocol, not a single brief search.
2. Add found communities to a Communities record with a date and an editable status, so the user can change their mind after experimenting.
3. Find each community's calendar and scrape it on a regular schedule; port results into a feed. Backend logic attaches scraped items to the right objects: group → events per group, with structured fields (time, location, cost, event type, source URL, RSVP link, recurrence, capacity/registration required).
4. Port events into a feed of streamlined cards. Selecting a card adds the event to the user's synced Google Calendar.
5. A non-feed selection view: calendar on the right, day-by-day feed on the left with minimal cards showing event type. Selecting from this view also adds to calendar.
6. Every event is typed: **community event** (tight recurring group, e.g., sailing club, book club), **community general** (loose community, e.g., a random Jewish event), or **one-off** (e.g., an AI conference — cool people, possible overlap with other communities).

## 3. Evaluation
1. Push a prompt to the user's phone after an event asking whether they attended.
2. Ask whether they liked it, whether they made good connections, about the culture, and how easy it was to get to know people.
3. If liked, mark that community as one to return to.
4. Over time, evaluate whether the user likes the community genre at all and specific venues; surface more venues (including private calendars) and more communities dynamically.
5. Weekly: suggest planning the week from the feed.
6. Ongoing: scheduled scraping of community calendars and ongoing discovery of new communities.
7. A log where the user records which groups and genres they like (e.g., sailing; sailing club 1 vs sailing club 2).

## 4. CRM
1. Record friends made: name, contact info, where met, which community.
2. Sync with phone contacts as far as the platform allows (import via share sheet/CSV on iOS); messages are sent via the phone, composed in the CRM.
3. Recall all friends and where they were met.
4. Weekly: surface people and suggest events to invite them to.
5. Tallies of who the user has connected with and how many times.
6. Eventually: suggest inviting groups of people to a larger event (e.g., a public festival).

## 5. Model routing (user-requested)
- Per-component model dropdowns (interview, persona synthesis, discovery research, scraping/extraction, weekly planning, invite suggestions).
- Onboarding step to enter provider keys (Anthropic, OpenRouter, Groq, Gemini, local endpoint).
- Run log per output: model, cost, latency. "Rerun with model X" on any output for side-by-side comparison.
- Mark which models are tool/search-capable for the discovery component.
