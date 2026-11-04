# UI design plan

How the app should look and feel on Android and web, and the order we build it in. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The technical decisions behind it are [ADR-0007](../adr/0007-one-expo-app-for-web-and-android.md) (one Expo app), [ADR-0008](../adr/0008-uniwind-and-react-native-reusables.md) (Uniwind + React Native Reusables) and [ADR-0009](../adr/0009-bundled-japanese-fonts.md) (bundled fonts).

## 1. Principles

1. **Stories come first.** Reading is the core activity. The interface stays quiet so the reader's furigana and marks can carry meaning.
2. **Calm and paper-like.** Warm paper, ink-dark text, lots of space and one restrained accent colour. No gamification, confetti or decorative "Japanese" ornament.
3. **Colour means something.** Indigo means "you can act on this". Vermilion means "this is in your Focus Set" and is used for nothing else.
4. **One app, two widths.** The same screens on Android and web, laid out for narrow (phone) and wide (desktop) screens, never forked per platform.
5. **Accessible by default.** Text contrast meets WCAG AA in light and dark, touch targets are at least 44 px, every icon-only control has an accessible label, the app respects the system font scale and reduce-motion setting.

## 2. Foundations

### 2.1 Stack

- Expo Router app in `apps/app` (renamed from `apps/mobile`), building Android and web (`expo export -p web`).
- Uniwind for styling, React Native Reusables (RNR) and RN Primitives for components, lucide-react-native for icons.
- react-native-reanimated only as far as RNR needs it.
- All design values live in `apps/app/global.css`. No hex values in components.

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
- The saved choice is applied before the first screen draws, so the wrong theme never flashes on screen.

### 2.4 Type

- **Interface:** Noto Sans JP (Regular, Medium, Bold).
- **Story text and Practice prompts:** Noto Serif JP (Regular, Bold).
- Fonts are bundled and loaded with `expo-font` on Android and from our own server on web. On web they are subsetted or lazy-loaded so only the reader pays for the serif. Add the OFL licence to `THIRD_PARTY_NOTICES.md`.

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

- Destinations: **Today**, **Stories**, **Practice**, **Grammar** and **Settings**, with real URLs on web (`/`, `/stories`, `/stories/:id`, `/practice`, `/grammar`, `/grammar/:id`, `/settings/:section`).
- **Narrow screens (under 1024 px):** bottom tab bar with five icons and labels. The Story reader hides the tab bar for full-screen reading.
- **Wide screens (1024 px and up):** a left sidebar (about 240 px) with the wordmark, the destinations and, at the bottom, the signed-in Learner and Log out. Page content has a maximum width (about 960 px); the reader column is narrower (see 4.1).
- Android hardware Back follows the Expo Router stack.

## 4. Screens

Built in this order. Each one counts as done only when it passes section 6.

### 4.1 Story Reader

- **Text column** about 40 Japanese characters wide, centred, in the serif font at the chosen Story text size. The Story Title (`display`) sits above with its English translation hidden until revealed.
- **Reading Panel** fixed above the text and the same width as the column, on `card` with a bottom border. It shows the Sentence Translation of the selected sentence (blurred until unblurred) and the current Lookup: the word, its reading, meaning, JLPT badge and pitch graph, or for a Grammar Span its Grammar Point and what it does. Its height is fixed so the text never jumps.
- **Marks** that look the same on Android and web:
  - Known word: no mark.
  - Word with a Dictionary Entry that isn't a Known Item: a 1 px dotted underline in `lookup-mark`, drawn as its own element rather than a text underline.
  - Grammar Span: `grammar` highlighter background with slightly rounded ends.
  - Focus Set item: its usual mark in `focus` (underline) or `grammar-focus` (highlight), slightly stronger.
  - Furigana: stacked above the word in `furigana`, shown according to the Furigana Threshold.
  - Selected sentence: `selected-sentence` background.
- **Lookup:** hover on web, press and hold on Android. The word's context menu (Dictionary Entry, Save to Item List) uses RNR Popover or Dropdown Menu next to the word.
- **Dictionary Entry, grammar details and Save to Item List** open as bottom sheets below the overlay breakpoint (640 px viewport) and centred dialogs at or above it. That breakpoint is the overlay rule's own — deliberately separate from the chrome's sidebar breakpoint (1024 px, section 3): at 700 px the chrome is still a tab bar but the overlays are centred dialogs, and below 640 px sheets pin the actions to the thumb.
- **Pitch graph** is SVG wrapped with `withUniwind`, so it uses `pitch` in both themes.
- **Footer:** Mark as Read (and undo), Practice this Story, and next or previous Story, with icons.

### 4.2 App shell

Tab bar and sidebar, Login (wordmark, username, password, and server address on Android), the theme provider and saved theme, fonts, and the shared state components from section 5.

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

On wide screens, 2 and 3 sit side by side.

### 4.5 Stories (Story Library)

- Today's Story pinned at the top, with Generate (On-demand Story with optional Genre and Theme) next to it.
- The library as a list on narrow screens and a grid of cards on wide screens. Each card shows the Story Title, its English translation hidden until revealed, Genre, Story Origin, date and a Read check, with mark-Read and delete in a menu.
- Filters: Unread or All, and Genre.

### 4.6 Grammar

Grammar Catalogue grouped by JLPT Level, with search. Each Grammar Point shows its pattern and whether it is Seeded, Observed or not known. Its detail page shows the explanation and example sentences in the serif font.

### 4.7 Settings and first-run setup

- **Hub and sections**, with two panes on wide screens (section list on the left, the open section on the right). Sections are Appearance (theme, Story text size), Reading, Stories, Item Lists, Starting Level, MaruMori, AI Providers and Server (address on Android, health check).
- **First-run setup** after the first login, skippable, in three steps: Starting Level, then MaruMori key and Sync, then AI Provider. Afterwards these settings live only in Settings.

## 5. Shared states

- **Loading:** skeleton placeholders shaped like the content, in `muted`. No full-screen spinners.
- **Empty:** one helpful line and one action, for example "No Stories yet." with Generate a Story.
- **Error:** an inline message in `destructive` with Retry, in the place of the content that failed. No blocking alerts.
- **Long-running work** (Story generation, Sync): a visible progress bar and a status line. The Learner can leave and come back.

## 6. Definition of done for a screen

- The existing Vitest tests for it are moved over and pass (react-native-web, as mobile's tests do today).
- Screenshot checks in light and dark, at narrow and wide widths, on Android and web.
- Contrast passes AA, every control can be reached with the keyboard on web, and icon-only controls have labels.
- No hardcoded colours, font sizes or fonts.

## 7. Order of work

1. **Trial build (about a day).** In a branch, confirm that Uniwind and RNR work with Expo SDK 58 and RN 0.88 on Android and in a web export, that the Noto JP fonts load, that switching between light, dark and system works with no flash, that an SVG follows the theme, and that a deep link reloads correctly when the Go server serves the export with an `index.html` fallback. If any of these fails, stop and rethink before porting.
2. **Rename and foundations.** `apps/mobile` → `apps/app`, add `global.css` with the palette and scales, fonts, icon and wordmark, and replace `theme.ts` and `ui.tsx` with RNR components.
3. **App shell** (4.2).
4. **Story Reader** (4.1).
5. **Practice** (4.3).
6. **Today, Stories, Grammar, Settings and setup** (4.4–4.7).
7. **Switch over.** Once the Expo web build matches `apps/web` for Login, Today, Stories, Practice, Grammar and Settings, change the Dockerfile's web build to `expo export -p web`, add the `index.html` fallback to the server, update the README, and delete `apps/web`.
