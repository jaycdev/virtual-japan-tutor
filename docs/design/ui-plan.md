# UI design plan

How the web app and the Android app should look and feel, and the order we build them in. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The technical decisions behind it are [ADR-0010](../adr/0010-separate-web-and-mobile-apps.md) (separate web and mobile apps sharing logic and tokens, superseding ADR-0007), [ADR-0008](../adr/0008-uniwind-and-react-native-reusables.md) (Uniwind + React Native Reusables on mobile) and [ADR-0009](../adr/0009-bundled-japanese-fonts.md) (bundled fonts).

## 1. Principles

1. **Stories come first.** Reading is the core activity. The interface stays quiet so the reader's furigana and marks can carry meaning.
2. **Calm and paper-like.** Warm paper, ink-dark text, lots of space and one restrained accent colour. No gamification, confetti or decorative "Japanese" ornament.
3. **Colour means something.** Indigo means "you can act on this". Vermilion means "this is in your Focus Set" and is used for nothing else.
4. **One design, two apps.** The web app and the mobile app share the same destinations, tokens and visual language, and each is built for its platform: the web app for a desktop browser with mouse and keyboard (still usable at phone widths), the mobile app for a phone held in one hand. Where a screen differs per app, this plan says so, so the two differ on purpose rather than by drift.
5. **Accessible by default.** Text contrast meets WCAG AA in light and dark, touch targets are at least 44 px, every icon-only control has an accessible label, the app respects the system font scale and reduce-motion setting.

## 2. Foundations

### 2.1 Stack

- **Web (`apps/web`):** Vite + React single-page app, React Router, Tailwind CSS 4, shadcn/ui on Radix, lucide-react for icons. Built with `vite build` into the static files the Go server serves from `WEB_DIR`.
- **Mobile (`apps/mobile`):** Expo Router app, Android, phone-only. Uniwind for styling, React Native Reusables (RNR) and RN Primitives for components, lucide-react-native for icons, react-native-reanimated only as far as RNR needs it.
- **Shared:** `@vjt/core` (screen logic hooks), `@vjt/api-client` and `@vjt/design`. All design values live in `packages/design`, which generates the theme CSS for both apps. No hex values in either app.

### 2.2 Colour

Starting palette. Every text/background pair must pass WCAG AA (4.5:1 body text, 3:1 large text and UI marks) before it ships, so adjust values if a check fails.

**RNR standard colours**

| Variable | Light | Dark | Used for |
| --- | --- | --- | --- |
| `background` | `#FAF7F0` warm paper | `#15161A` sumi ink | Page background |
| `foreground` | `#1F1D1A` ink | `#E9E5DB` | Body text |
| `card` / `popover` | `#FFFDF8` | `#1D1E23` | Cards, sheets, dialogs, menus |
| `primary` | `#2F4B7C` indigo 藍 | `#8FA8D8` | Main buttons, links, active tab |
| `primary-foreground` | `#FAF7F0` | `#15161A` | Text on primary |
| `secondary` | `#EFEAE0` | `#26272D` | Secondary buttons, chips |
| `muted` | `#EFEAE0` | `#26272D` | Quiet surfaces, skeletons |
| `muted-foreground` | `#6B655C` | `#A39E94` | Secondary text, captions |
| `accent` | `#E6ECF5` | `#2A3346` | Hover and pressed backgrounds |
| `destructive` | `#A3312A` | `#E5736A` | Delete, errors |
| `border` / `input` | `#E2DCD0` | `#33343A` | Lines, field outlines |
| `ring` | `#2F4B7C` | `#8FA8D8` | Focus outline |

**Reader and app colours**

| Variable | Light | Dark | Used for |
| --- | --- | --- | --- |
| `focus` | `#B5452F` vermilion 朱 | `#E07A5F` | Focus Set marks and badges only |
| `grammar` | `#F3E7B3` pale kihada | `#3A3622` muted olive | Grammar Span highlight |
| `grammar-focus` | `#EBCF7A` | `#5A4E26` | Grammar Span that is in the Focus Set |
| `lookup-mark` | `#8A8378` | `#7E796F` | Dotted underline under words with a Dictionary Entry that aren't Known Items |
| `furigana` | `#6B655C` | `#A39E94` | Furigana |
| `pitch` | `#2F4B7C` | `#8FA8D8` | Pitch accent graph line and dots |
| `success` | `#3F6B45` | `#86B98C` | Correct answer |
| `selected-sentence` | `#E6ECF5` | `#232C3D` | The selected sentence in a Story |
| `backdrop` | ink at 40% | black at 60% | Behind sheets and dialogs |

JLPT badges use `secondary` with `foreground` text, the same for every level. A Story shouldn't look like a traffic light.

### 2.3 Theme switching

- Light, Dark or System, chosen in Settings › Appearance and saved **per device** (local storage on web, secure-store on Android). The default is System.
- The saved choice is applied before the first screen draws, so the wrong theme never flashes on screen. On web an inline script in `index.html` sets the `dark` class before the bundle loads.

### 2.4 Type

- **Interface:** Noto Sans JP (Regular, Medium, Bold).
- **Story text and Practice prompts:** Noto Serif JP (Regular, Bold).
- Fonts are bundled: TTFs loaded with `expo-font` in `apps/mobile`, and unicode-range woff2 slices served by our own server from `apps/web`, so only pages that render kanji or serif text download those slices. The OFL licence is in `THIRD_PARTY_NOTICES.md`.

Interface scale (rem, 1 rem = 16 px):

| Name | Size / line height | Used for |
| --- | --- | --- |
| `caption` | 12 / 16 | Badges, metadata |
| `small` | 14 / 20 | Secondary text, labels |
| `body` | 16 / 24 | Default |
| `title-sm` | 18 / 26 | Card titles, section headings |
| `title` | 22 / 30 | Page titles |
| `display` | 28 / 36 | Today greeting, Story Title in the reader |

Story text sizes (the new **Story text size** reading setting, saved per device, on top of the system font scale):

| Setting | Story text | Furigana | Line height |
| --- | --- | --- | --- |
| S | 18 | 9 | 2.0 |
| M (default) | 21 | 10.5 | 2.1 |
| L | 24 | 12 | 2.2 |
| XL | 28 | 14 | 2.2 |

The line height leaves room for stacked furigana without lines colliding. The Reading Panel scales with the setting.

### 2.5 Space, shape and depth

- Spacing uses Tailwind's 4 px scale. Default screen padding is 16 px (narrow) or 32 px (wide), and the gap between sections is 24 px.
- Corner radius (`--radius`) is 10 px for cards and sheets, 8 px for buttons and fields, and fully rounded for chips and badges.
- Depth comes from borders and surface colour, not shadows. Only popovers, menus and sheets get a soft shadow.

### 2.6 Icons and identity

- lucide icons at 20 px (24 px in tab bars), with the stroke following the text colour. Text glyph controls ("< Back", "x", "Older >") are replaced with icons that have accessible labels.
- The app icon and wordmark are 読 in indigo on paper, with a dark version. They are used for the Android adaptive icon (replacing `#E6F4FE`), the web favicon and the Login screen.

### 2.7 Motion

- Only short fades (150 ms) and sheet or dialog slides (200–250 ms, ease-out). No decorative animation.
- All motion is off when the system's reduce-motion setting is on.

## 3. Layout and navigation

- Destinations in both apps: **Today**, **Stories**, **Practice**, **Grammar** and **Settings**.
- **Web:** real URLs (`/`, `/stories`, `/stories/:id`, `/practice`, `/grammar`, `/grammar/:id`, `/settings/:section`, `/setup`, `/login`). From 1024 px, a left sidebar (about 240 px) with the wordmark, the destinations and, at the bottom, the signed-in Learner and Log out. Below 1024 px the sidebar collapses to a top bar with the wordmark and a menu button that opens it as a sheet. Page content has a maximum width (about 960 px); the reader column is narrower (see 4.1). The Story reader is the one route that lifts that maximum, because its column is measured in characters rather than pixels. Every destination and the reader can be used fully with the keyboard.
- **Mobile:** a bottom tab bar with five icons and labels. The Story reader hides the tab bar for full-screen reading. Android hardware Back follows the Expo Router stack. Layouts are single-column; there is no wide layout.

## 4. Screens

Built in this order. Each one counts as done only when it passes section 6.

### 4.1 Story Reader

- **Text column** about 40 Japanese characters wide, centred, in the serif font at the chosen Story text size. On web that is exact: 40 times the size in pixels, and never more than the page gives it, so a wider window centres the column and gives it more air rather than making the line longer. This is why the reader route lifts the 960 px page maximum instead (3): the column then reaches its 40 characters whenever the window has room for it, 1120 px at XL, and stops at what fits, never scrolling sideways, below that. The Reading Panel below takes the same width, so one rule covers both. The Story Title (`display`) sits above with its English translation hidden until revealed.
- **Reading Panel** fixed above the text and the same width as the column, on `card` with a bottom border. It shows the Sentence Translation of the selected sentence (blurred until unblurred) and the current Lookup: the word, its reading, a muted Part of Speech caption (the first sense only, e.g. "Verb · transitive" or "Noun · takes する"), meaning, JLPT badge and pitch graph, or for a Grammar Span its Grammar Point and what it does. Its height is fixed so the text never jumps.
- **Marks**, with the same colours and meaning in both apps:
  - Known word: no mark.
  - Word with a Dictionary Entry that isn't a Known Item: a 1 px dotted underline in `lookup-mark`. Web uses CSS `text-decoration` (dotted, offset clear of the next line's furigana); mobile draws it as its own element.
  - Grammar Span: `grammar` highlighter background with slightly rounded ends.
  - Focus Set item: its usual mark in `focus` (underline) or `grammar-focus` (highlight), slightly stronger.
  - Furigana: stacked above the word in `furigana`, shown according to the Furigana Threshold. Web uses `<ruby>` / `<rt>`, so copied text and screen readers get the base text; mobile uses the token-column layout.
  - Selected sentence: `selected-sentence` background.
- **Lookup:** on web, hovering over a word (or focusing it with the keyboard) shows the Lookup, and a click opens the word's context menu (Dictionary Entry, Save to Item List) as a shadcn Popover next to the word. Text stays selectable. The left and right arrow keys move the selected sentence, Enter reveals its translation, and Escape closes any overlay. On mobile, press and hold shows the Lookup and opens the RNR context menu.
- **Dictionary Entry, grammar details and Save to Item List:** on web, centred shadcn Dialogs (a bottom Sheet below a 640 px viewport, so a phone browser still gets thumb-reach actions); on mobile, always bottom sheets with the actions pinned to the thumb.
- **Pitch graph** is inline SVG drawn with `currentColor` in `pitch` on web, and SVG wrapped with `withUniwind` on mobile, so it follows the theme in both.
- **Footer:** Mark as Read (and undo), Practice this Story, and next or previous Story, with icons.

### 4.2 App shell

- **Web:** sidebar and collapsed top bar, Login (wordmark, username, password; the API is on the same origin), and a route guard that sends signed-out visitors to `/login` and then back to the page they asked for.
- **Mobile:** tab bar, and Login with the server address.
- **Both:** the theme provider and saved theme, fonts, and the shared state components from section 5.

### 4.3 Practice

- One Exercise at a time on a centred card (max about 560 px), with the prompt in the serif font at a large size and the answer area below.
- A thin progress bar for the Practice Session at the top.
- Feedback is a calm inline line after each answer: `success` or `destructive` with an icon, the correct answer and a Continue button. No full-screen celebration.
- A short end-of-session summary: how many Exercises, how many were right, and which items need another look.

### 4.4 Today

Top to bottom:

1. Greeting with the date in the Learner's Timezone.
2. Today's Story card: title, Genre, length and an Open button, or Generate while a Story is being written, with progress.
3. Practice call to action: how many Focus Set items are waiting, with a Start button.
4. The Focus Set at a glance: up to about 8 items as chips in `focus`, with "See all".
5. Last Sync line (time and result) with Sync now.

On web at 1024 px and up, 2 and 3 sit side by side.

### 4.5 Stories (Story Library)

- Today's Story pinned at the top, with Generate (On-demand Story with optional Genre and Theme) next to it.
- The library as a grid of cards on web (with a list view toggle) and a list on mobile. Each card shows the Story Title, its English translation hidden until revealed, Genre, Story Origin, date and a Read check, with mark-Read and delete in a menu.
- Filters: Unread or All, and Genre.

### 4.6 Grammar

Grammar Catalogue grouped by JLPT Level, with search. Each Grammar Point shows its pattern and whether it is Seeded, Observed or not known. Its detail page shows the explanation and example sentences in the serif font.

### 4.7 Settings and first-run setup

- **Hub and sections**: on web, two panes (the section list on the left, the open section on the right, each at `/settings/:section`); on mobile, a hub list that pushes each section as its own screen. Sections are Appearance (theme, Story text size), Reading, Stories, Item Lists, Starting Level, MaruMori, AI Providers and Server (address on Android, health check).
- **First-run setup** after the first login, skippable, in three steps: Starting Level, then MaruMori key and Sync, then AI Provider. Afterwards these settings live only in Settings.

## 5. Shared states

- **Loading:** skeleton placeholders shaped like the content, in `muted`. No full-screen spinners.
- **Empty:** one helpful line and one action, for example "No Stories yet." with Generate a Story.
- **Error:** an inline message in `destructive` with Retry, in the place of the content that failed. No blocking alerts.
- **Long-running work** (Story generation, Sync): a visible progress bar and a status line. The Learner can leave and come back.

## 6. Definition of done for a screen

- **Web:** Vitest + Testing Library on jsdom cover the screen's behaviour. Screenshot checks in light and dark at 1280 px and 390 px widths. Every control can be reached and used with the keyboard.
- **Mobile:** the Vitest tests (on react-native-web) cover the screen's behaviour. Screenshot checks in light and dark on an Android phone.
- **Both:** contrast passes AA, icon-only controls have labels, and there are no hardcoded colours, font sizes or fonts.

## 7. Order of work

### 7.1 Done: the single-app rollout (#41)

The trial build, design foundations, app shell and every screen in section 4 were built once in the Expo app (`apps/app`) for both platforms, and `apps/web` was deleted. ADR-0010 reverses the single-app decision. Those screens remain the reference for the mobile app and for the look of the web app.

### 7.2 The split (ADR-0010)

1. **Design tokens package.** `packages/design` holds the palette, type scale, Story text sizes, radii and font names, and generates `web.css` (Tailwind 4, `.dark` class) and `native.css` (Uniwind `@variant light` / `dark`). A test fails if the generated files are stale. The Expo app's `global.css` imports `native.css`.
2. **Mobile becomes phone-only.** Rename `apps/app` to `apps/mobile`. Remove the web export, the Sidebar, wide layouts, the dialog-on-wide overlays, two-pane Settings, web fonts and the react-native-web font override. Its Vitest tests keep running on react-native-web.
3. **Web foundations and shell.** New `apps/web`: Vite, React Router, Tailwind 4 with `@vjt/design/web.css`, shadcn/ui, lucide-react, fonts and theme with no flash, Sidebar and collapsed top bar, Login, route guard, and the shared states (4.2, 5).
4. **Web Story Reader** (4.1), with `<ruby>` furigana, CSS marks, hover and keyboard Lookup.
5. **Web Practice** (4.3).
6. **Web Today and Stories** (4.4, 4.5).
7. **Web Grammar** (4.6).
8. **Web Settings and first-run setup** (4.7).
9. **Switch over.** The Dockerfile builds `apps/web` with `vite build`, CI and the README point at the two apps, and the server keeps its `index.html` fallback.