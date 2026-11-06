/**
 * The one typed string table behind every sentence @vjt/core shows a Learner
 * (issue #125). `en` is the copy the apps show today, byte for byte — the
 * existing tests pin it. `ja` carries its furigana inline in the Aozora
 * style, 今日《きょう》, so one column serves both Japanese options; the
 * i18n tests check every kanji in it is covered and every {placeholder}
 * appears in both columns. `{name}` values are substituted as plain data:
 * they are never parsed for furigana.
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
    ja: "ログインが必要《ひつよう》です",
  },
  "errors.invalid_credentials": {
    en: "Invalid username or password",
    ja: "ユーザー名《めい》またはパスワードが正《ただ》しくありません",
  },
  "errors.too_many_attempts": {
    en: "Too many login attempts",
    ja: "試《ため》し回数《かいすう》が過《す》ぎました。少《すこ》し後《あと》でお試《ため》しください",
  },
  "errors.payload_too_large": { en: "Request body too large", ja: "リクエストのデータが過大《かだい》です" },
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
    ja: "すでに物語《ものがたり》を作成《さくせい》中《ちゅう》です",
  },
  "errors.no_story": { en: "No story", ja: "物語《ものがたり》がありません" },
  "errors.practice_no_items": { en: "No items to practice", ja: "練習《れんしゅう》できる項目《こうもく》がありません" },
  "errors.already_answered": { en: "Already answered", ja: "すでに回答《かいとう》しました" },
  "errors.duplicate_name": { en: "Duplicate name", ja: "同《おな》じ名《な》前《まえ》がすでに使《つか》われています" },
  "errors.reserved_list": { en: "Reserved list name", ja: "この名《な》前《まえ》は使《つか》えません" },
  "errors.invalid_key": { en: "Invalid key", ja: "APIキーが無《な》効《こう》です" },
  "errors.no_key": { en: "No key", ja: "APIキーがありません" },
  "errors.sync_running": {
    en: "A sync is already running",
    ja: "すでに同期《どうき》が実行《じっこう》中《ちゅう》です",
  },
  "errors.invalid_level": { en: "Invalid level", ja: "レベルが正《ただ》しくありません" },
  "errors.name_taken": { en: "Name taken", ja: "この名《な》前《まえ》はすでに使《つか》われています" },
  "errors.invalid_provider": { en: "Invalid provider", ja: "AIプロバイダーが無《な》効《こう》です" },
  "errors.provider_in_use": { en: "Provider is in use", ja: "このAIプロバイダーはまだ使《つか》われています" },
  "errors.no_ai_provider": { en: "No AI provider", ja: "AIプロバイダーがありません" },
  "errors.emptyResponse": { en: "Empty response", ja: "空《から》の応答《おうとう》でした" },

  // — Sign-in (the app owns the form; these are core's failure lines) —
  "auth.loginFailed": { en: "Login failed", ja: "ログインに失敗《しっぱい》しました" },
  "auth.tryAgainLater": {
    en: "Too many attempts. Try again later.",
    ja: "試《ため》し回数《かいすう》が過《す》ぎました。後《あと》でもう一《いち》度《ど》お試《ため》しください",
  },
  "auth.tryAgainIn": {
    en: "Too many attempts. Try again in {secs} seconds.",
    ja: "試《ため》し回数《かいすう》が過《す》ぎました。{secs}秒《びょう》後《ご》にもう一《いち》度《ど》お試《ため》しください",
  },
  "auth.sessionSaveFailed": {
    en: "Could not save the session on this device",
    ja: "この端末《たんまつ》にセッションを保存《ほぞん》できませんでした",
  },
  "auth.serverAnswered": { en: "Server answered {status}", ja: "サーバーが {status} と応答《おうとう》しました" },

  // — Story writing —
  "story.startFailed": { en: "Couldn't start writing a Story.", ja: "物語《ものがたり》の作成《さくせい》を開始《かいし》できませんでした。" },
  "story.runFailed": { en: "Couldn't write a Story for you.", ja: "あなたのための物語《ものがたり》を書《か》けませんでした。" },
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
  "stage.preparing": { en: "Preparing…", ja: "準備《じゅんび》中《ちゅう》…" },
  "stage.writing": { en: "Writing…", ja: "作成《さくせい》中《ちゅう》…" },
  "stage.writingAttempt": {
    en: "Writing… attempt {attempt} of {max}",
    ja: "作成《さくせい》中《ちゅう》… {attempt}/{max}回目《かいもく》",
  },
  "stage.checking": { en: "Checking it fits your vocabulary…", ja: "語彙《ごい》に合《あ》うかどうか確認《かくにん》しています…" },
  "stage.saving": { en: "Saving…", ja: "保存《ほぞん》中《ちゅう》…" },

  // — Today's greeting —
  "greeting.hello": { en: "Hello", ja: "こんにちは" },
  "greeting.morning": { en: "Good morning", ja: "お早《はや》うございます" },
  "greeting.afternoon": { en: "Good afternoon", ja: "こんにちは" },
  "greeting.evening": { en: "Good evening", ja: "こんばんは" },
  "greeting.lateNight": { en: "Still studying", ja: "まだ勉強《べんきょう》中《ちゅう》ですか" },

  // — Settings sections (titles and blurbs; ids stay route segments) —
  "section.appearanceTitle": { en: "Appearance", ja: "表示《ひょうじ》" },
  "section.appearanceBlurb": { en: "Colour theme and Story text size", ja: "テーマカラーと物語《ものがたり》の文字《もじ》大《おお》きさ" },
  "section.readingTitle": { en: "Reading", ja: "読書《どくしょ》" },
  "section.readingBlurb": { en: "Translation blur and Lookup hold", ja: "訳《やく》のぼかしと辞書《じしょ》長押《ながお》し" },
  "section.storiesTitle": { en: "Stories", ja: "物語《ものがたり》" },
  "section.storiesBlurb": {
    en: "Furigana threshold and future story tastes",
    ja: "ふりがな表示《ひょうじ》レベルとこれからの物語《ものがたり》の趣向《しゅこう》",
  },
  "section.listsTitle": { en: "Item Lists", ja: "アイテムリスト" },
  "section.listsBlurb": { en: "Lists, boosting and saved items", ja: "リスト、優先《ゆうせん》と保存《ほぞん》アイテム" },
  "section.levelTitle": { en: "Starting Level", ja: "開始《かいし》レベル" },
  "section.levelBlurb": { en: "N5–N1 known grammar baseline", ja: "N5～N1 の既習《きしゅう》文法《ぶんぽう》基準《きじゅん》" },
  "section.marumoriTitle": { en: "MaruMori", ja: "MaruMori" },
  "section.marumoriBlurb": { en: "Connect your Junji profile and Sync", ja: "Junji アカウント接続《せつぞく》と同期《どうき》" },
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
    ja: "そのアドレスは無《な》反応《のう》でした。ホストとポートを確認《かくにん》してください — 現在《げんざい》のアドレスが使《つか》われ続《つづ》けます",
  },

  // — Item kinds and the list rows —
  "item.kanji": { en: "Kanji", ja: "漢字《かんじ》" },
  "item.vocabulary": { en: "Word", ja: "単語《たんご》" },
  "item.grammar": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "itemList.defaultWord": { en: "default", ja: "標準《ひょうじゅん》" },
  "itemList.oneItem": { en: "{count} item", ja: "{count}件《けん》" },
  "itemList.manyItems": { en: "{count} items", ja: "{count}件《けん》" },
  "itemList.boostingWord": { en: "boosting", ja: "優先《ゆうせん》" },

  // — AI Provider rows —
  "aiTask.story": { en: "Story generation", ja: "物語《ものがたり》生成《せいせい》" },
  "aiTask.grammarContent": { en: "Grammar content", ja: "文法《ぶんぽう》コンテンツ" },
  "settings.ai.usedFor": { en: "used for {tasks}", ja: "{tasks}に使用《しよう》" },
  "settings.ai.keySaved": { en: "Key saved", ja: "キー保存《ほぞん》済《ずみ》" },
  "settings.ai.noKey": { en: "No key", ja: "キーなし" },

  // — Focus Set chips —
  "focus.grammarPoint": { en: "Grammar point", ja: "文法《ぶんぽう》ポイント" },
  "focus.word": { en: "Word", ja: "単語《たんご》" },

  // — MaruMori Sync rows —
  "sync.failed": { en: "Sync failed: {error}", ja: "同期《どうき》に失敗《しっぱい》しました: {error}" },
  "sync.unknownError": { en: "unknown error", ja: "原因《げんいん》不《ふ》明《めい》" },
  "sync.complete": { en: "Sync complete", ja: "同期《どうき》完《かん》了《りょう》" },
  "sync.counts": {
    en: "Sync complete — {new} new Known Items, {levelChanges} level changes, {disappeared} disappeared",
    ja: "同期《どうき》完《かん》了《りょう》 — 新《あらた》な既習項目《きしゅうこうもく》 {new}件《けん》、レベル変《へん》化《か》 {levelChanges}件《けん》、消《き》えた項目《こうもく》 {disappeared}件《けん》",
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
    ja: "アイテムリストの読《よ》込《こ》み中《ちゅう》です",
  },
  "reader.menu.saveToTarget": { en: "Save to {list}", ja: "{list}に保存《ほぞん》" },
  "reader.menu.saveToDefault": { en: "Save to the default list", ja: "標準《ひょうじゅん》のアイテムリストに保存《ほぞん》" },
  "reader.menu.saveToOther": { en: "Save into another Item List", ja: "他《ほか》のアイテムリストに保存《ほぞん》" },

  // — Practice exercises (the server's English stays for en) —
  "exercise.recognition": { en: "What does this mean?", ja: "意味《いみ》はどれですか？" },
  "exercise.grammar_cloze": {
    en: "Which pattern completes the sentence?",
    ja: "文《ぶん》を完成《かんせい》させるのはどのパターンですか？",
  },
} as const satisfies Record<string, { en: string; ja: string }>;

/** Every table entry key — the type-checked union `keyof typeof strings`. */
export type StringKey = keyof typeof strings;
