# Virtual Japan Tutor

A tutor that takes what a learner already knows on MaruMori and turns it into practice and short AI-written stories, focusing on what they know least well.

## App

**Today**:
The Learner's starting page. It brings together Today's Story, the Focus Set at a glance, a way into a Practice Session and the state of the last Sync.
_Avoid_: Home, dashboard

## Learner and knowledge

**Learner**:
The person studying Japanese with the app. The MVP has exactly one.
_Avoid_: Student, account, user (in domain discussion)

**Item**:
A single unit of Japanese knowledge: a Kanji, a Vocabulary word or a Grammar Point.
_Avoid_: Card, entry, subject

**Grammar Point**:
A grammar pattern at a specific JLPT Level. The same pattern at two levels with different meanings is two Grammar Points (e.g. だけ at N5 and N4).
_Avoid_: Grammar rule, grammar item

**Known Item**:
An Item the Learner is considered to have learned, whether synced from MaruMori, seeded from their Starting Level, or observed in their grammar reviews.
_Avoid_: Learned item, studied item

**Grammar Catalogue**:
The app's own list of Grammar Points, organised by JLPT Level.
_Avoid_: Grammar list, grammar database

**Starting Level**:
The JLPT Level the Learner declares when they first set up the app. Grammar Points at or below it are treated as Known Items.
_Avoid_: Current level, base level

**Seeded Grammar**:
Known Grammar Points that come from the Starting Level and haven't been confirmed by MaruMori activity.

**Observed Grammar**:
Known Grammar Points discovered by seeing them in the Learner's MaruMori grammar activity.

## Levels and mastery

**JLPT Level**:
How advanced an Item is, from N5 (easiest) to N1.
_Avoid_: Level (unqualified), difficulty

**SRS Level**:
MaruMori's 1–9 stage for an Item in its spaced-repetition system. The app reads it but never changes it.
_Avoid_: Stage, level (unqualified)

**Mastery**:
How well the Learner knows a specific Item, on a 0–1 scale, combining its SRS Level, Level Trend, Practice Record and Weak Signals. Recomputed on every read; never stored.
_Avoid_: Strength, proficiency, level

**Level Trend**:
How an Item's SRS Level last moved between MaruMori Syncs. A drop is a strong weak sign.
_Avoid_: Regression, progress

**Newly Observed Grammar**:
Observed Grammar the Learner came across within the new-grammar window; the Focus Set targets it straight away.
_Avoid_: Fresh grammar, recent grammar

## Practice

**Focus Set**:
The group of low-Mastery Known Items that Practice Sessions and Stories currently target.
_Avoid_: Review plan, weak list

**Practice Session**:
One sitting of Exercises drawn mainly from the Focus Set.
_Avoid_: Review (that's MaruMori's term), quiz, lesson

**Exercise**:
A single prompt the Learner answers, such as a recognition prompt, a grammar cloze, or a comprehension question about a Story.
_Avoid_: Question (unqualified), drill

**Practice Record**:
The history of the Learner's Exercise results in this app.
_Avoid_: Review history, stats

## Stories

**Story**:
A short, AI-written Japanese text built mostly from Known Items, with Focus Set items deliberately included.
_Avoid_: Passage, text, reading

**Story Title**:
The Japanese title every Story carries. Its English translation is hidden until the Learner reveals it.
_Avoid_: Name, heading

**Genre**:
The kind of Story, such as mystery, travel or slice of life. Every Story has one.
_Avoid_: Category, type

**Theme**:
What a Story is about, in free text, such as "a robot running a ramen shop". Every new Story has one.
_Avoid_: Topic, prompt, subject

**Preferred Genre** / **Preferred Theme**:
The Genre and Theme the Learner wants most of their Stories to lean towards. Automatic Stories use them most of the time, but not always.
_Avoid_: Default genre, fixed genre

**Story Origin**:
Whether a Story is Automatic or On-demand. Both kinds are AI-written.
_Avoid_: Generated vs manual, source

**Automatic Story**:
A Story the app makes in the background, at most one per day in the Learner's Timezone and only when the Learner has no unread Automatic Story.
_Avoid_: Daily story, generated story, background story

**Today's Story**:
The Learner's newest Automatic Story, which the Stories page opens on. It can be from an earlier day if that one is still unread. An On-demand Story is never Today's Story.
_Avoid_: Ready story, current story, daily story

**Learner's Timezone**:
The timezone that decides when the Learner's day starts. If the Learner hasn't chosen one, the server's timezone is used.
_Avoid_: Locale, region

**On-demand Story**:
A Story the Learner asks for, optionally choosing its Genre and Theme.
_Avoid_: Manual story, custom story

**Read**:
The Learner's own mark that they have finished a Story. They can undo it. It is separate from a Story having written Practice Records.
_Avoid_: Opened, seen, completed, practiced

**Story Library**:
All of the Learner's Stories, which they can browse, mark Read or delete.
_Avoid_: Story list, history, archive

**Furigana Threshold**:
The SRS Level, set by the Learner (default 3), at or above which vocabulary in a Story is shown without furigana.

**Reading Panel**:
The area fixed above a Story while reading. It shows the Sentence Translation of the selected sentence and the details of the word being looked up.
_Avoid_: Info box, sidebar, tooltip, gloss

**Lookup**:
Briefly showing a word or Grammar Span's details in the Reading Panel, by hovering over it on web or pressing and holding it on mobile. A word shows its meaning, forms and JLPT Level, and a Grammar Span shows its Grammar Point and what it does.
_Avoid_: Gloss tap, hover

**Grammar Span**:
The part of a Story sentence that expresses a Grammar Point (e.g. てしまった in 食べてしまった). It is a Lookup target in its own right, separate from the words around it.
_Avoid_: Grammar highlight, grammar token

**Sentence Translation**:
The English translation of one sentence in a Story, shown in the Reading Panel when that sentence is selected. It can be blurred or unblurred.
_Avoid_: Translation toggle

**Dictionary Entry**:
The full dictionary view of a word, opened from a word's context menu.
_Avoid_: Definition popup

**Item List**:
A named collection of words and Grammar Points the Learner has saved while reading Stories. The Learner can create as many as they like.
_Avoid_: Word list, saved words, favourites, study list (that's MaruMori's term)

**Boosting List**:
An Item List marked so that saving something to it raises its priority for the Focus Set, or makes it appear more often as a stretch item if it isn't a Known Item yet.
_Avoid_: Priority list

**Weak Signal**:
An implicit sign from reading behaviour that the Learner doesn't know a Known Item well, such as a deliberate Lookup, unblurring a Sentence Translation, or saving it to a Boosting List.
_Avoid_: Penalty, miss

## Integrations

**Sync**:
Pulling the Learner's Known Items and SRS Levels from MaruMori into the app.
_Avoid_: Import, refresh

**AI Provider**:
A saved OpenAI-compatible endpoint (base URL, key and model) the app can use to generate Stories.
_Avoid_: LLM, model, backend
