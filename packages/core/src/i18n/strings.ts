/**
 * The one typed string table behind every sentence @vjt/core shows a Learner
 * (issue #125). `en` is the copy the apps show today, byte for byte — the
 * existing tests pin it. `ja` carries its furigana inline in the Aozora
 * style, 今日《きょう》, so one column serves both Japanese options; the
 * i18n tests check every kanji in it is covered and every {placeholder}
 * appears in both columns. `{name}` values are substituted as plain data:
 * they are never parsed for furigana.
 *
 * The `exercise.*` and `errors.*` English text is only shown as a fallback
 * (the server answers in English, and exercises ask in Japanese); the columns
 * exist so the tests can pin the mapping and the client has something to
 * show when the server's own line is missing.
 *
 * Keys are dotted by area, but the object stays FLAT: `keyof typeof strings`
 * is the key union, and TS checks every call site against it.
 */

export const strings = {
  // — Failures the hooks show —
  "errors.unreachable": { en: "Cannot reach the server", ja: "サーバーに接続《せつぞく》できません" },
  "errors.failed": { en: "Request failed", ja: "リクエストに失敗《しっぱい》しました" },
  "errors.failedStatus": {
    en: "Request failed ({status})",
    ja: "リクエストに失敗《しっぱい》しました（{status}）",
  },
  // One line per server error code (the Go API's own English stays for en
  // via the fallback; the en column records what the server says).
  "errors.bad_request": { en: "Malformed request", ja: "リクエストの内容《ないよう》が正《ただ》しくありません" },
  "errors.internal": { en: "Internal server error", ja: "サーバー側《がわ》で問題《もんだい》が起《お》きました" },
  "errors.unauthorized": {
    en: "Missing, invalid or expired session token",
    ja: "セッションがないか、不正《ふせい》または期限《きげん》切《ぎ》れです",
  },
  "errors.invalid_credentials": {
    en: "Invalid username or password",
    ja: "ユーザー名《めい》またはパスワードが正《ただ》しくありません",
  },
  "errors.too_many_attempts": {
    en: "Too many login attempts",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。もう一度《いちど》お試《ため》しください",
  },
  "errors.payload_too_large": { en: "Request body too large", ja: "リクエストのデータが大《おお》きすぎます" },
  "errors.not_found": { en: "Not found", ja: "見《み》つかりませんでした" },
  "errors.invalid_settings": { en: "Invalid settings", ja: "設定《せってい》が正《ただ》しくありません" },
  "errors.invalid_rating": { en: "Invalid rating", ja: "評価《ひょうか》が正《ただ》しくありません" },
  "errors.story_not_ready": {
    en: "Story is not ready",
    ja: "物語《ものがたり》はまだ読《よ》める状態《じょうたい》にありません",
  },
  "errors.invalid_question": { en: "Invalid question", ja: "問題《もんだい》が正《ただ》しくありません" },
  "errors.invalid_answer": { en: "Invalid answer", ja: "回答《かいとう》が正《ただ》しくありません" },
  "errors.invalid_input": { en: "Invalid input", ja: "入力《にゅうりょく》が正《ただ》しくありません" },
  "errors.invalid_threshold": { en: "Invalid threshold", ja: "しきい値《ち》が正《ただ》しくありません" },
  "errors.invalid_preference": { en: "Invalid preference", ja: "優先《ゆうせん》設定《せってい》が正《ただ》しくありません" },
  "errors.invalid_timezone": { en: "Invalid timezone", ja: "タイムゾーンが正《ただ》しくありません" },
  "errors.generation_running": {
    en: "A story is already being generated",
    ja: "すでに物語《ものがたり》を作成中《さくせいちゅう》です",
  },
  "errors.no_story": { en: "No story", ja: "物語《ものがたり》がありません" },
  "errors.practice_no_items": { en: "No items to practice", ja: "練習《れんしゅう》できる項目《こうもく》がありません" },
  "errors.already_answered": { en: "Already answered", ja: "すでに回答《かいとう》しました" },
  "errors.duplicate_name": { en: "Duplicate name", ja: "同《おな》じ名前《なまえ》がすでに使《つか》われています" },
  "errors.reserved_list": { en: "Reserved list name", ja: "この名前《なまえ》は使《つか》えません" },
  "errors.invalid_key": { en: "Invalid key", ja: "APIキーが無効《むこう》です" },
  "errors.no_key": { en: "No key", ja: "APIキーがありません" },
  "errors.sync_running": {
    en: "A sync is already running",
    ja: "すでに同期《どうき》が実行中《じっこうちゅう》です",
  },
  "errors.invalid_level": { en: "Invalid level", ja: "レベルが正《ただ》しくありません" },
  "errors.name_taken": { en: "Name taken", ja: "この名前《なまえ》はすでに使《つか》われています" },
  "errors.invalid_provider": { en: "Invalid provider", ja: "AIプロバイダーが無効《むこう》です" },
  "errors.provider_in_use": { en: "Provider is in use", ja: "このAIプロバイダーはまだ使《つか》われています" },
  "errors.no_ai_provider": { en: "No AI provider", ja: "AIプロバイダーがありません" },
  "errors.emptyResponse": { en: "Empty response", ja: "空《から》の応答《おうとう》でした" },

  // — Sign-in (the app owns the form; these are core's failure lines) —
  "auth.loginFailed": { en: "Login failed", ja: "ログインに失敗《しっぱい》しました" },
  "auth.tryAgainLater": {
    en: "Too many attempts. Try again later.",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。もう一度《いちど》お試《ため》しください",
  },
  "auth.tryAgainIn": {
    en: "Too many attempts. Try again in {secs} seconds.",
    ja: "試行回数《しこうかいすう》が多《おお》すぎます。{secs}秒後《びょうご》にもう一度《いちど》お試《ため》しください",
  },
  "auth.sessionSaveFailed": {
    en: "Could not save the session on this device",
    ja: "この端末《たんまつ》にセッションを保存《ほぞん》できませんでした",
  },
  "auth.serverAnswered": { en: "Server answered {status}", ja: "サーバーが {status} と応答《おうとう》しました" },

  // — Story writing —
  "story.startFailed": { en: "Couldn't start writing a Story.", ja: "物語《ものがたり》の作成《さくせい》を開始《かいし》できませんでした。" },
  "story.runFailed": { en: "Couldn’t write a Story for you.", ja: "物語《ものがたり》を作成《さくせい》できませんでした。" },
  "story.originOnDemand": { en: "On demand", ja: "オンデマンド" },
  "story.originAutomatic": { en: "Automatic", ja: "自動生成《じどうせいせい》" },
  "story.noGenre": { en: "Story", ja: "物語《ものがたり》" },

  // — Genres (display only; stored values stay English). English maps only
  // diary/travel/mystery today; Japanese also covers the server's presets. —
  "genre.diary": { en: "Diary", ja: "日記《にっき》" },
  "genre.travel": { en: "Travel", ja: "旅行《りょこう》" },
  "genre.mystery": { en: "Mystery", ja: "ミステリー" },
  "genre.sliceOfLife": { en: "Slice of life", ja: "日常《にちじょう》" },
  "genre.folktale": { en: "Folktale", ja: "昔話《むかしばなし》" },
  "genre.food": { en: "Food", ja: "食《た》べ物《もの》" },
  "genre.schoolLife": { en: "School life", ja: "学校生活《がっこうせいかつ》" },
  "genre.cityLife": { en: "City life", ja: "都会《とかい》" },
  "genre.nature": { en: "Nature", ja: "自然《しぜん》" },

  // — The generation run's stages —
  "stage.preparing": { en: "Preparing…", ja: "準備中《じゅんびちゅう》…" },
  "stage.writing": { en: "Writing…", ja: "作成中《さくせいちゅう》…" },
  "stage.writingAttempt": {
    en: "Writing… attempt {attempt} of {max}",
    ja: "作成中《さくせいちゅう》… {attempt}回目《かいめ》（全《ぜん》{max}回《かい》）",
  },
  "stage.checking": { en: "Checking it fits your vocabulary…", ja: "語彙《ごい》に合《あ》うかどうか確認《かくにん》しています…" },
  "stage.saving": { en: "Saving…", ja: "保存中《ほぞんちゅう》…" },

  // — Today's greeting —
  "greeting.hello": { en: "Hello", ja: "こんにちは" },
  "greeting.morning": { en: "Good morning", ja: "おはようございます" },
  "greeting.afternoon": { en: "Good afternoon", ja: "こんにちは" },
  "greeting.evening": { en: "Good evening", ja: "こんばんは" },
  "greeting.lateNight": { en: "Still studying", ja: "遅《おそ》くまで勉強中《べんきょうちゅう》ですね" },

  // — Settings sections (titles and blurbs; ids stay route segments) —
  "section.appearanceTitle": { en: "Appearance", ja: "表示《ひょうじ》" },
  "section.appearanceBlurb": { en: "Colour theme and Story text size", ja: "テーマカラーと物語《ものがたり》の文字《もじ》の大《おお》きさ" },
  "section.readingTitle": { en: "Reading", ja: "読解《どっかい》" },
  "section.readingBlurb": { en: "Translation blur and Lookup hold", ja: "文《ぶん》の訳《やく》のぼかしと長押《ながお》しの時間《じかん》" },
  "section.storiesTitle": { en: "Stories", ja: "物語《ものがたり》" },
  "section.storiesBlurb": {
    en: "Furigana threshold and future story tastes",
    ja: "ふりがな表示《ひょうじ》レベルとこれからの物語《ものがたり》の趣向《しゅこう》",
  },
  "section.listsTitle": { en: "Item Lists", ja: "リスト" },
  "section.listsBlurb": { en: "Lists, boosting and saved items", ja: "リスト、優先《ゆうせん》と保存《ほぞん》項目《こうもく》" },
  "section.levelTitle": { en: "Starting Level", ja: "開始《かいし》レベル" },
  "section.levelBlurb": { en: "N5–N1 known grammar baseline", ja: "N5～N1 の既習《きしゅう》文法《ぶんぽう》基準《きじゅん》" },
  "section.marumoriTitle": { en: "MaruMori", ja: "MaruMori" },
  "section.marumoriBlurb": { en: "Connect your Junji profile and Sync", ja: "Junji プロフィールの接続《せつぞく》と同期《どうき》" },
  "section.aiTitle": { en: "AI Providers", ja: "AIプロバイダー" },
  "section.aiBlurb": { en: "Endpoints, keys and task assignments", ja: "エンドポイント、キー、タスク割当《わりあて》" },
  "section.serverTitle": { en: "Server", ja: "サーバー" },
  "section.serverBlurb": { en: "Connection health and server address", ja: "接続《せつぞく》状態《じょうたい》とサーバーアドレス" },

  // — The mobile Server settings reachability probe —
  "serverHealth.answered": {
    en: "That address answered {status} instead of a healthy /health. It does not look like a Virtual Japan Tutor server — the current address is still in use.",
    ja: "そのアドレスは正常《せいじょう》な /health の代《かわ》りに {status} と応答《おうとう》しました。Virtual Japan Tutor のサーバーではないようです — 現在《げんざい》のアドレスが使《つか》われ続《つづ》けます",
  },
  "serverHealth.noAnswer": {
    en: "That address did not answer. Check the host and port — the current address is still in use.",
    ja: "そのアドレスから応答《おうとう》がありませんでした。ホストとポートを確認《かくにん》してください — 現在《げんざい》のアドレスが使《つか》われ続《つづ》けます",
  },

  // — Item kinds and the list rows —
  "item.kanji": { en: "Kanji", ja: "漢字《かんじ》" },
  "item.vocabulary": { en: "Word", ja: "単語《たんご》" },
  "item.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "itemList.defaultWord": { en: "default", ja: "既定《きてい》" },
  "itemList.oneItem": { en: "{count} item", ja: "{count}項目《こうもく》" },
  "itemList.manyItems": { en: "{count} items", ja: "{count}項目《こうもく》" },
  "itemList.boostingWord": { en: "boosting", ja: "優先《ゆうせん》" },

  // — AI Provider rows —
  "aiTask.story": { en: "Story generation", ja: "物語《ものがたり》生成《せいせい》" },
  "aiTask.grammarContent": { en: "Grammar content", ja: "文法《ぶんぽう》コンテンツ" },
  "settings.ai.usedFor": { en: "used for {tasks}", ja: "{tasks}に使用《しよう》" },
  "settings.ai.keySaved": { en: "Key saved", ja: "キー保存《ほぞん》済《ず》み" },
  "settings.ai.noKey": { en: "No key", ja: "キーなし" },

  // — Focus Set chips —
  "focus.grammarPoint": { en: "Grammar point", ja: "文法《ぶんぽう》ポイント" },
  "focus.word": { en: "Word", ja: "単語《たんご》" },

  // — MaruMori Sync rows —
  "sync.failed": { en: "Sync failed: {error}", ja: "同期《どうき》に失敗《しっぱい》しました: {error}" },
  "sync.unknownError": { en: "unknown error", ja: "原因《げんいん》不明《ふめい》" },
  "sync.complete": { en: "Sync complete", ja: "同期《どうき》完了《かんりょう》" },
  "sync.counts": {
    en: "Sync complete — {new} new Known Items, {levelChanges} level changes, {disappeared} disappeared",
    ja: "同期《どうき》完了《かんりょう》 — 新《あらた》な既習項目《きしゅうこうもく》 {new}件《けん》、レベル変化《へんか》 {levelChanges}件《けん》、消《き》えた項目《こうもく》 {disappeared}件《けん》",
  },
  "sync.runCounts": {
    en: "{kanji} kanji, {vocabulary} vocabulary",
    ja: "漢字《かんじ》 {kanji}件《けん》、語彙《ごい》 {vocabulary}件《けん》",
  },

  // — Grammar Catalogue Matching rows —
  "grammarReview.level": { en: "(MaruMori level {level})", ja: "（MaruMori レベル {level}）" },
  "grammarReview.matched": {
    en: "— matched point {point}, level was ambiguous",
    ja: "— 一致《いち》したポイント {point}、レベルが曖昧《あいまい》でした",
  },
  "grammarReview.noMatch": { en: "— no Grammar Catalogue match", ja: "— 文法《ぶんぽう》カタログの一致《いち》なし" },
  "grammar.updated": {
    en: "Grammar updated: {added} added, {removed} removed.",
    ja: "文法《ぶんぽう》を更新《こうしん》しました: {added}件《けん》追加《ついか》、{removed}件《けん》削除《さくじょ》",
  },

  // — Settings field rules —
  "settings.lookupHoldRule": {
    en: "The hold is a whole number of milliseconds from 0 to 10000.",
    ja: "長押《ながお》し時間《じかん》は 0 から 10000 のミリ秒《びょう》の整数《せいすう》です。",
  },

  // — The Lookup Menu (issue #14) —
  "reader.menu.dictionary": { en: "Dictionary", ja: "辞書《じしょ》" },
  "reader.menu.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "reader.menu.save": { en: "Save", ja: "保存《ほぞん》" },
  "reader.menu.saveTo": { en: "Save to…", ja: "保存《ほぞん》…" },
  "reader.menu.unlinked": {
    en: "This word did not match a dictionary entry",
    ja: "この語《ことば》は辞書《じしょ》の項目《こうもく》に見《み》つかりませんでした",
  },
  "reader.menu.lookupFailed": {
    en: "The dictionary did not answer — hold again to try once more",
    ja: "辞書《じしょ》が応答《おうとう》しませんでした — 再《ふたた》び長押《ながお》しすると再試行《さいしこう》できます",
  },
  "reader.menu.listsLoading": {
    en: "Your Item Lists are still loading",
    ja: "リストの読《よ》み込《こ》み中《ちゅう》です",
  },
  "reader.menu.saveToTarget": { en: "Save to {list}", ja: "{list}に保存《ほぞん》" },
  "reader.menu.saveToDefault": { en: "Save to the default list", ja: "既定《きてい》のリストに保存《ほぞん》" },
  "reader.menu.saveToOther": { en: "Save into another Item List", ja: "他《ほか》のリストに保存《ほぞん》" },

  // — Practice exercises (the server's English stays for en) —
  "exercise.recognition": { en: "What does this mean?", ja: "意味《いみ》はどれですか？" },
  "exercise.grammar_cloze": {
    en: "Which pattern completes the sentence?",
    ja: "文《ぶん》を完成《かんせい》させるのはどのパターンですか？",
  },

  // — Nav, page titles, and shell chrome (issue #125 Part 2) —
  // The brand is the product name: same text in both columns on purpose.
  "brand.app": { en: "Virtual Japan Tutor", ja: "Virtual Japan Tutor" },
  "nav.today": { en: "Today", ja: "今日《きょう》" },
  "nav.stories": { en: "Stories", ja: "物語《ものがたり》" },
  "nav.practice": { en: "Practice", ja: "練習《れんしゅう》" },
  "nav.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "nav.settings": { en: "Settings", ja: "設定《せってい》" },
  "nav.main": { en: "Main", ja: "メイン" },
  "title.logIn": { en: "Log in", ja: "ログイン" },
  "title.setUp": { en: "Set up", ja: "セットアップ" },
  "title.notFound": { en: "Not found", ja: "ページが見《み》つかりません" },
  "shell.skipToContent": { en: "Skip to content", ja: "本文《ほんぶん》へ" },
  "shell.openNavigation": { en: "Open navigation", ja: "ナビゲーションを開《ひら》く" },
  "shell.navTitle": { en: "Navigation", ja: "ナビゲーション" },
  "shell.navDescription": {
    en: "Move between Today, Stories, Practice, Grammar and Settings.",
    ja: "今日《きょう》、物語《ものがたり》、練習《れんしゅう》、文法《ぶんぽう》、設定《せってい》を移動《いどう》します。",
  },
  "shell.signedInAs": { en: "Signed in as", ja: "ログイン中《ちゅう》" },
  "shell.logOut": { en: "Log out", ja: "ログアウト" },
  "common.retry": { en: "Retry", ja: "もう一度《いちど》" },
  "notFound.message": { en: "There is nothing at this address.", ja: "このアドレスにページはありません。" },
  "notFound.goToToday": { en: "Go to Today", ja: "今日《きょう》へ" },
} as const satisfies Record<string, { en: string; ja: string }>;

/** Every table entry key — the type-checked union `keyof typeof strings`. */
export type StringKey = keyof typeof strings;
