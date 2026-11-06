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
  "section.appearanceBlurb": { en: "Colour theme and Story text size", ja: "配色《はいしょく》と物語《ものがたり》の文字《もじ》の大《おお》きさ" },
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
  "settings.ai.keySaved": { en: "Key saved", ja: "キー保存済《ほぞんず》み" },
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
    ja: "同期《どうき》完了《かんりょう》 — 新《あら》たな既習項目《きしゅうこうもく》 {new}件《けん》、レベル変化《へんか》 {levelChanges}件《けん》、消《き》えた項目《こうもく》 {disappeared}件《けん》",
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
    ja: "文法《ぶんぽう》を更新《こうしん》しました: {added}件《けん》追加《ついか》、{removed}件《けん》削除《さくじょ》しました。",
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
    ja: "この語《ことば》は辞書《じしょ》に見《み》つかりませんでした",
  },
  "reader.menu.lookupFailed": {
    en: "The dictionary did not answer — hold again to try once more",
    ja: "辞書《じしょ》が応答《おうとう》しませんでした — もう一度《いちど》長押《ながお》しすると再試行《さいしこう》できます",
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
  "settings.notFound": { en: "That settings section doesn’t exist.", ja: "その設定《せってい》セクションはありません。" },
  "settings.back": { en: "Back to Settings", ja: "設定《せってい》へ戻《もど》る" },
  "settings.backShort": { en: "← Settings", ja: "← 設定《せってい》" },
  "settings.sectionsAria": { en: "Settings sections", ja: "設定《せってい》セクション" },
  "settings.focusTitle": { en: "Today’s Focus Set", ja: "本日《ほんじつ》の重点項目《じゅうてんこうもく》" },
  // Whole-sentence keys (issue #125): the load-failure line
  // is one table entry, so its furigana survives — a {what} param fed from
  // tp() would be inserted as plain text.
  "settings.readingLoadFailed": {
    en: "Cannot load your reading settings: {message}",
    ja: "あなたの読解《どっかい》設定《せってい》を読《よ》み込《こ》めません: {message}",
  },
  "settings.readingSaved": {
    en: "Saved. The reader uses this from the next lookup on.",
    ja: "保存《ほぞん》しました。次《つぎ》の検索《けんさく》から読解《どっかい》パネルに使《つか》われます。",
  },
  "settings.blurLabel": {
    en: "Blur the translation behind Weak Signals",
    ja: "Weak Signalの語《ご》の訳《やく》をぼかす",
  },
  "settings.blurHint": {
    en: "A word you have not practised enough shows its meaning only after you ask.",
    ja: "十分《じゅうぶん》に練習《れんしゅう》していない語《ご》は、あなたが求《もと》めたときだけ意味《いみ》を表示《ひょうじ》します。",
  },
  "settings.holdNote": {
    en: "How long you must hold a lookup before it counts as a Weak Signal. 0 signals every lookup.",
    ja: "検索《けんさく》を何《なん》ミリ秒《びょう》押《お》し続《つづ》けるとWeak Signalとして数《かぞ》えるかを決《き》めます。0なら、すべての検索《けんさく》が対象《たいしょう》です。",
  },
  "settings.holdLabel": {
    en: "Lookup hold before a Weak Signal (ms, 0–10000)",
    ja: "Weak Signalまでの検索《けんさく》長押《ながお》し（ms、0〜10000）",
  },
  "settings.saveReading": { en: "Save reading settings", ja: "読解《どっかい》設定《せってい》を保存《ほぞん》" },

  // The Server section: a health read only (ui-plan 4.7).
  "server.addressLabel": { en: "Server address", ja: "サーバーアドレス" },
  "server.addressNote": {
    en: "The app talks to the server it was loaded from, so there is no address to change here.",
    ja: "このアプリは読《よ》み込《こ》んだサーバーと通信《つうしん》するので、ここで変《か》えられるアドレスはありません。",
  },
  "server.unreachable": { en: "Cannot reach the server: {message}", ja: "サーバーに接続《せつぞく》できません: {message}" },
  "server.healthy": {
    en: "The server is reachable and its database is connected.",
    ja: "サーバーは接続《せつぞく》可能《かのう》で、データベースもつながっています。",
  },
  "server.answeredButDbUnreachable": {
    en: "The server answered, but cannot reach its database.",
    ja: "サーバーは応答《おうとう》しましたが、データベースに接続《せつぞく》できません。",
  },
  "server.answeredButDegraded": {
    en: "The server answered, but reports a degraded part.",
    ja: "サーバーは応答《おうとう》しましたが、一部《いちぶ》の機能《きのう》に問題《もんだい》があります。",
  },
  "server.checkAgain": { en: "Check again", ja: "もう一度《いちど》確認《かくにん》" },

  // The full Focus Set behind Today's "See all".
  "settings.focusLoadFailed": {
    en: "Cannot load your Focus Set: {message}",
    ja: "重点項目《じゅうてんこうもく》を読《よ》み込《こ》めません: {message}",
  },
  "settings.focusNote": {
    en: "These are the items your Stories and Practice are built around.",
    ja: "これらは物語《ものがたり》と練習《れんしゅう》が作《つく》られる基《もと》の項目《こうもく》です。",
  },
  "settings.focusNoteLimit": {
    en: "These are the items your Stories and Practice are built around, up to {size} at a time.",
    ja: "これらは物語《ものがたり》と練習《れんしゅう》が作《つく》られる基《もと》の項目《こうもく》で、同時《どうじ》に最大《さいだい》{size}件《けん》です。",
  },
  "settings.focusEmpty": {
    en: "Nothing chosen yet — a Sync, a Story or a Practice session fills it in.",
    ja: "まだ何《なに》も選《えら》ばれていません — 同期《どうき》、物語《ものがたり》、練習《れんしゅう》セッションが埋《う》めます。",
  },
  "settings.focusAria": { en: "Focus Set", ja: "重点項目《じゅうてんこうもく》" },

  // The Starting Level section (issue #6): the N5–N1 baseline and the read-only
  // grammar-match review list. The level codes themselves are data.
  "settings.levelLoadFailed": {
    en: "Cannot load your Starting Level: {message}",
    ja: "開始《かいし》レベルを読《よ》み込《こ》めません: {message}",
  },
  "settings.levelCurrent": { en: "Starting level: {level}", ja: "開始《かいし》レベル: {level}" },
  "settings.levelUnset": {
    en: "Not chosen yet. Pick one to mark everything at or below it as known.",
    ja: "まだ決《き》められていません。レベルを選《えら》ぶと、それ以下《いかに》の文法《ぶんぽう》はすべて知《し》っている扱《あつか》いになります。",
  },
  "settings.levelLegend": { en: "Choose your level", ja: "レベルを選《えら》ぶ" },
  "settings.levelSave": { en: "Save level", ja: "レベルを保存《ほぞん》" },
  "settings.levelReviewHeading": { en: "Review these grammar matches", ja: "文法《ぶんぽう》の照合《しょうごう》結果《けっか》の確認《かくにん》" },
  "settings.reviewLoadFailed": {
    en: "Cannot load the review list: {message}",
    ja: "見直《みなお》しリストを読《よ》み込《こ》めません: {message}",
  },
  "settings.reviewEmpty": { en: "Nothing needs a second look.", ja: "見直《みなお》しは不要《ふよう》です。" },
  "settings.reviewNote": {
    en: "These MaruMori grammar points did not match the Catalogue cleanly. They re-check themselves on later Syncs.",
    ja: "MaruMoriのこれらの文法《ぶんぽう》ポイントはカタログと明確《めいかく》に一致《いっち》しませんでした。以降《いこう》の同期《どうき》で自動的《じどうてき》に再確認《さいかくにん》されます。",
  },
  "nav.main": { en: "Main", ja: "メイン" },
  "title.logIn": { en: "Log in", ja: "ログイン" },
  "title.setUp": { en: "Set up", ja: "セットアップ" },
  "title.notFound": { en: "Not found", ja: "ページが見《み》つかりません" },
  "title.story": { en: "Story", ja: "物語《ものがたり》" },
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
  "common.previous": { en: "Previous", ja: "前《まえ》へ" },
  "common.next": { en: "Next", ja: "次《つぎ》へ" },

  // — Stories page (issue #125) —
  "stories.writing": { en: "Writing…", ja: "書《か》いています…" },
  "stories.libraryHeading": { en: "Story Library", ja: "ライブラリ" },
  "stories.ariaLayout": { en: "Library layout", ja: "ライブラリの表示《ひょうじ》形式《けいしき》" },
  "stories.gridLayout": { en: "Grid layout", ja: "グリッド表示《ひょうじ》" },
  "stories.listLayout": { en: "List layout", ja: "リスト表示《ひょうじ》" },
  "stories.filterUnread": { en: "Unread", ja: "未読《みどく》" },
  "stories.filterAll": { en: "All", ja: "すべて" },
  "stories.genre": { en: "Genre", ja: "ジャンル" },
  "stories.allGenres": { en: "All genres", ja: "すべてのジャンル" },
  "stories.noneMatch": {
    en: "No Stories match these filters.",
    ja: "このフィルタに合《あ》う物語《ものがたり》はありません。",
  },
  "stories.clearFilters": { en: "Clear filters", ja: "フィルタをクリア" },
  "stories.noneFiltered": {
    en: "No Stories yet — and nothing to filter.",
    ja: "物語《ものがたり》はまだありません。フィルタも適用《てきよう》できません。",
  },
  "stories.noneAny": {
    en: "No Stories yet. The tutor writes one for you every day, or Generate writes one now.",
    ja: "物語《ものがたり》はまだありません。チューターは毎日《まいにち》書《か》きます。「物語《ものがたり》を作《つく》る」で今《いま》書《か》くこともできます。",
  },
  "stories.hiddenByFilter": {
    en: "{hidden} of the {total} Stories on this page are hidden by your filters.",
    ja: "このページ{total}編《ぺん》の物語《ものがたり》のうち{hidden}編《ぺん》がフィルタで隠《かく》れています。",
  },
  "stories.newer": { en: "Newer stories", ja: "新《あたら》しい物語《ものがたり》" },
  "stories.older": { en: "Older stories", ja: "以前《いぜん》の物語《ものがたり》" },
  "stories.pageRange": { en: "{from}-{to} of {total}", ja: "{total}編《ぺん》中《ちゅう》{from}〜{to}編《ぺん》" },
  "stories.generateBody": {
    en: "One new Story now. Genre and Theme are optional — leave them on Any and the tutor chooses.",
    ja: "今《いま》、新《あら》たな物語《ものがたり》を一編《いっぺん》。ジャンルとテーマは任意《にんい》です。選《えら》ばないままにするとチューターが選《えら》びます。",
  },
  "stories.theme": { en: "Theme", ja: "テーマ" },
  "stories.anyGenre": { en: "Any genre", ja: "どのジャンルでも" },
  "stories.anyTheme": { en: "Any theme", ja: "どのテーマでも" },
  "stories.keepWriting": {
    en: "It keeps writing if you close this dialog.",
    ja: "このダイアログを閉《と》じても書《か》き続《つづ》けます。",
  },
  "stories.generateConfirm": { en: "Generate", ja: "作《つく》る" },
  "stories.deleteTitle": {
    en: "Delete this Story?",
    ja: "この物語《ものがたり》を削除《さくじょ》しますか？",
  },
  "stories.deleteBody": {
    en: "“{title}” goes away for good, along with its rating. Your Practice Records stay.",
    ja: "「{title}」は評価《ひょうか》とともに削除《さくじょ》されます。練習《れんしゅう》記録《きろく》は残《のこ》ります。",
  },
  "stories.deleteKeep": { en: "Keep", ja: "残《のこ》す" },
  "stories.delete": { en: "Delete", ja: "削除《さくじょ》" },
  "stories.readBadge": { en: "Read", ja: "読《よ》み終《お》わり" },
  "stories.ariaOpen": { en: "Open story: {title}", ja: "物語《ものがたり》を開《ひら》く: {title}" },
  "stories.ariaActions": { en: "Actions for {title}", ja: "{title}の操作《そうさ》" },
  "stories.markRead": { en: "Mark read", ja: "読《よ》んだことにする" },
  "stories.markUnread": { en: "Mark unread", ja: "未読《みどく》にする" },
  "stories.ariaShowTranslation": {
    en: "Show title translation",
    ja: "タイトル訳《やく》を表示《ひょうじ》",
  },
  "stories.translationHidden": {
    en: "Title translation hidden — click to show",
    ja: "タイトル訳《やく》は隠《かく》れています — クリックで表示《ひょうじ》",
  },
  "common.cancel": { en: "Cancel", ja: "キャンセル" },
  "notFound.message": { en: "There is nothing at this address.", ja: "このアドレスにページはありません。" },
  "notFound.goToToday": { en: "Go to Today", ja: "今日《きょう》へ" },

  // — Login, first-run setup, and placeholder pages (issue #125 Part 2) —
  "login.username": { en: "Username", ja: "ユーザー名《めい》" },
  "login.password": { en: "Password", ja: "パスワード" },
  "login.logIn": { en: "Log in", ja: "ログイン" },
  "login.loggingIn": { en: "Logging in…", ja: "ログイン中《ちゅう》…" },
  "comingSoon.soon": { en: "Coming soon in #{issue}.", ja: "#{issue} で公開《こうかい》予定《よてい》です。" },
  "comingSoon.backToToday": { en: "Back to Today", ja: "今日《きょう》に戻《もど》る" },
  "setup.intro": {
    en: "Three short steps to set you up. You can skip any of them and change everything later under Settings.",
    ja: "短《みじか》い3つのステップで設定《せってい》します。どのステップもスキップでき、全《すべ》ての設定《せってい》は後《あと》で変《か》えられます。",
  },
  "setup.stepsLabel": { en: "Setup steps", ja: "設定《せってい》のステップ" },
  "setup.stepOf": { en: "Step {step} of {total}", ja: "ステップ{step}/{total}" },
  "setup.levelBody": {
    en: "We will build your First Story around this.",
    ja: "初《はじ》めの物語《ものがたり》はこのレベルをもとに作《つく》ります。",
  },
  "setup.marumoriBody": {
    en: "Add your key to keep your kanji study in sync.",
    ja: "漢字《かんじ》の学習《がくしゅう》を同期《どうき》するには、キーを追加《ついか》してください。",
  },
  "setup.aiBody": {
    en: "Tell us which model writes your Stories.",
    ja: "物語《ものがたり》を書《か》くモデルを選《えら》んでください。",
  },
  "setup.blockedNote": {
    en: "The step could not be saved. Fix it and try again, or skip this step.",
    ja: "ステップを保存《ほぞん》できませんでした。修正《しゅうせい》してもう一度《いちど》試《ため》すか、このステップをスキップしてください。",
  },
  "setup.back": { en: "Back", ja: "前《まえ》へ" },
  "setup.skipAll": { en: "Skip setup", ja: "設定《せってい》をスキップ" },
  "setup.skipStep": { en: "Skip this step", ja: "このステップをスキップ" },
  "setup.next": { en: "Next", ja: "次《つぎ》へ" },
  "setup.finish": { en: "Finish", ja: "完了《かんりょう》" },
  "today.timezoneUnavailable": {
    en: "Timezone unavailable — showing your browser’s time.",
    ja: "タイムゾーンを取得《しゅとく》できません。ブラウザの時《とき》を表示《ひょうじ》しています。",
  },
  "today.storyHeading": { en: "Today’s Story", ja: "今日《きょう》の物語《ものがたり》" },
  "today.storyEmptyToday": {
    en: "No Story yet — the tutor writes one for you every day.",
    ja: "物語《ものがたり》はまだありません。チューターは毎日《まいにち》書《か》きます。",
  },
  "today.storyEmptyStories": {
    en: "No Story for today yet — the tutor writes one for you every day.",
    ja: "今日《きょう》の物語《ものがたり》はまだありません。チューターは毎日《まいにち》書《か》きます。",
  },
  "today.storyGenerating": {
    en: "A new Story is on its way — you can leave and come back.",
    ja: "新《あら》たな物語《ものがたり》を作《つく》っています。離《はな》れても戻《もど》って見《み》られます。",
  },
  "today.storyError": {
    en: "Cannot load today’s Story: {message}",
    ja: "今日《きょう》の物語《ものがたり》を読《よ》み込《こ》めません: {message}",
  },
  "today.storyGenerate": { en: "Generate a Story", ja: "物語《ものがたり》を作《つく》る" },
  "today.storyRetry": { en: "Try again", ja: "もう一度《いちど》試《ため》す" },
  "today.storyCheckAgain": { en: "Check again", ja: "もう一度《いちど》確《たし》かめる" },
  "today.storyStillUnread": {
    en: "Still unread from {date}.",
    ja: "{date}の読《よ》んでいない物語《ものがたり》があります。",
  },
  "today.storyReadAgain": { en: "Read again", ja: "もう一度《いちど》読《よ》む" },
  "today.storyOpen": { en: "Open", ja: "開《ひら》く" },
  "today.storyAriaReadAgain": {
    en: "Read again today’s Story: {title}",
    ja: "今日《きょう》の物語《ものがたり》をもう一度《いちど》読《よ》む: {title}",
  },
  "today.storyAriaOpen": {
    en: "Open today’s Story: {title}",
    ja: "今日《きょう》の物語《ものがたり》を開《ひら》く: {title}",
  },
  "today.storyReadyNow": { en: "Ready, read now", ja: "読《よ》み始《はじ》められます" },
  "today.storyNewerWriting": {
    en: "A newer Story is being written.",
    ja: "新《あら》たな物語《ものがたり》を書《か》いています。",
  },
  "today.syncNow": { en: "Sync now", ja: "今《いま》すぐ同期《どうき》" },
  "today.syncSyncing": { en: "Syncing…", ja: "同期中《どうきちゅう》…" },
  "today.moreCount": { en: "+{count} more", ja: "他《ほか》{count}件《けん》" },
  "today.focusSetHeading": { en: "Focus Set", ja: "重点項目《じゅうてんこうもく》" },
  "today.seeAll": { en: "See all", ja: "すべて見《み》る" },
  "today.focusReadError": {
    en: "Your Focus Set could not be read.",
    ja: "重点項目《じゅうてんこうもく》を読《よ》み込《こ》めませんでした。",
  },
  "today.focusNothingChosen": {
    en: "Nothing chosen yet — a Sync, a Story or a Practice session fills it in.",
    ja: "まだ選《えら》ばれていません。同期《どうき》・物語《ものがたり》・練習《れんしゅう》で自動的《じどうてき》に決《き》まります。",
  },
  "today.focusAriaGlance": { en: "Focus Set at a glance", ja: "重点項目《じゅうてんこうもく》の一覧《いちらん》" },
  "today.lastSyncHeading": { en: "Last sync", ja: "最終《さいしゅう》同期《どうき》" },
  "today.syncFailedFallback": { en: "Sync failed.", ja: "同期《どうき》に失敗《しっぱい》しました。" },
  "today.syncSucceededNote": { en: "Sync succeeded.", ja: "同期《どうき》が完了《かんりょう》しました。" },
  "today.syncNotLinked": {
    en: "No MaruMori account linked yet, so nothing has been synced.",
    ja: "MaruMoriアカウントが接続《せつぞく》されていないため、同期《どうき》されていません。",
  },
  "today.syncLinkMaruMori": { en: "Link MaruMori", ja: "MaruMoriを接続《せつぞく》" },
  "today.syncFailedLine": {
    en: "Last sync failed {time}.",
    ja: "最終《さいしゅう》同期《どうき》は{time}に失敗《しっぱい》しました。",
  },
  "today.syncNoneYet": {
    en: "No sync has finished yet. Press Sync now to pull your knowledge across.",
    ja: "まだ同期《どうき》が完了《かんりょう》していません。「今《いま》すぐ同期《どうき》」を押《お》して学習《がくしゅう》状況《じょうきょう》を取《と》り込《こ》んでください。",
  },
  "today.syncSucceededLine": {
    en: "Last sync succeeded {time}.",
    ja: "最終《さいしゅう》同期《どうき》は{time}に完了《かんりょう》しました。",
  },
  "today.syncNoCounts": {
    en: "The sync finished with no counts to report.",
    ja: "同期《どうき》は報告《ほうこく》できる件数《けんすう》なく終《お》わりました。",
  },
  "today.syncResultCounts": {
    en: "{new} new item{newPlural}, {levelChanges} level change{levelPlural}, {linked} linked to reference data.",
    ja: "新《あら》たな項目《こうもく》{new}件《けん》{newPlural}、レベル変化《へんか》{levelChanges}件《けん》{levelPlural}、参照《さんしょう》データにリンク済《ず》み{linked}件《けん》。",
  },
  "today.practiceHeading": { en: "Practice", ja: "練習《れんしゅう》" },
  "today.practiceWaitingNone": {
    en: "Nothing is waiting in your Focus Set yet.",
    ja: "重点項目《じゅうてんこうもく》に練習《れんしゅう》待《ま》ちの項目《こうもく》はありません。",
  },
  "today.practiceWaitingCount": {
    en: "{count} Focus Set item{plural} waiting.",
    ja: "練習《れんしゅう》待《ま》ちの重点項目《じゅうてんこうもく》が{count}件《けん》{plural}あります。",
  },
  "today.practiceSessionNote": {
    en: "A session is built from your Focus Set, so there is nothing to practise until a Sync or a Story adds items.",
    ja: "練習《れんしゅう》は重点項目《じゅうてんこうもく》で作《つく》ります。同期《どうき》や物語《ものがたり》で項目《こうもく》が増《ふ》えるまで練習《れんしゅう》できません。",
  },
  "today.practiceStart": { en: "Start", ja: "始《はじ》める" },
  "today.practiceStartAria": { en: "Start practice", ja: "練習《れんしゅう》を始《はじ》める" },
  "today.practiceSession": { en: "{done} of {total} done · {kind}", ja: "{done}/{total}完了《かんりょう》 · {kind}" },
  "language.legend": { en: "Interface language", ja: "表示《ひょうじ》言語《げんご》" },
  "language.hint": {
    en: "Saved on this device. Stories, exercises and dictionary lookups stay Japanese whatever you choose.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。物語《ものがたり》・練習《れんしゅう》・辞書《じしょ》の検索結果《けんさくけっか》はどの設定《せってい》でも日本語《にほんご》のままです。",
  },
  "settings.themeLegend": { en: "Theme", ja: "配色《はいしょく》" },
  "settings.themeLight": { en: "Light", ja: "ライト" },
  "settings.themeDark": { en: "Dark", ja: "ダーク" },
  "settings.themeSystem": { en: "System", ja: "システム" },
  "settings.storyLoadFailed": {
    en: "Cannot load your story settings: {message}",
    ja: "あなたの物語《ものがたり》設定《せってい》を読《よ》み込《こ》めません: {message}",
  },
  "settings.storySaved": {
    en: "Saved. The next Story written for you uses this.",
    ja: "保存《ほぞん》しました。次《つぎ》にあなた用《よう》に書《か》かれる物語《ものがたり》に使《つか》われます。",
  },
  "settings.furiganaLegend": { en: "Furigana Threshold", ja: "ふりがな基準《きじゅん》" },
  "settings.furiganaNote": {
    en: "Words you have practised below this SRS level show reading help.",
    ja: "このSRSレベル未満《みまん》で練習《れんしゅう》した語《ことば》には、読《よ》み助《たす》けを表示《ひょうじ》します。",
  },
  "settings.genreLabel": { en: "Preferred genre", ja: "好《す》きなジャンル" },
  "settings.genrePlaceholder": { en: "travel, mystery… empty = surprise me", ja: "旅行《りょこう》、ミステリー… 空《から》ならお任《まか》せ" },
  "settings.themeLabel": { en: "Preferred theme", ja: "好《す》きなテーマ" },
  "settings.themePlaceholder": {
    en: "a robot running a ramen shop — empty = none",
    ja: "ラーメン店《てん》を営《いとな》むロボット — 空《から》ならなし",
  },
  "settings.timezoneNote": {
    en: "This decides which local day each Automatic Story belongs to.",
    ja: "自動生成《じどうせいせい》の物語《ものがたり》が現地《げんち》のどの日《ひ》に属《ぞく》するかを決《き》めます。",
  },
  "settings.timezoneLabel": { en: "Your timezone", ja: "あなたのタイムゾーン" },
  "settings.timezonePlaceholder": {
    en: "Asia/Tokyo — empty = the server’s day",
    ja: "Asia/Tokyo — 空《から》ならサーバーの日《ひ》",
  },
  "settings.timezoneDevice": {
    en: "Use my device’s timezone ({tz})",
    ja: "端末《たんまつ》のタイムゾーンを使《つか》う（{tz}）",
  },
  "settings.suggestionsAria": { en: "{label} suggestions", ja: "{label}の候補《こうほ》" },
  "settings.saveStories": { en: "Save story settings", ja: "物語《ものがたり》設定《せってい》を保存《ほぞん》" },

  // The MaruMori section: connect with an API key, Sync now, recent Syncs.
  "marumori.loadFailed": {
    en: "Cannot load MaruMori status: {message}",
    ja: "MaruMoriの状態《じょうたい》を読《よ》み込《こ》めません: {message}",
  },
  "marumori.connected": { en: "Connected to MaruMori.", ja: "MaruMoriと接続《せつぞく》しました。" },
  "marumori.keyRemoved": { en: "The MaruMori key was removed.", ja: "MaruMoriのキーを削除《さくじょ》しました。" },
  "marumori.notConnected": { en: "Not connected.", ja: "接続《せつぞく》していません。" },
  "marumori.counts": {
    en: "Known kanji: {kanji} · Known vocabulary: {vocabulary} · Vocabulary linked: {rate}%",
    ja: "既習項目《きしゅうこうもく》の漢字《かんじ》: {kanji} · 既習項目《きしゅうこうもく》の語彙《ごい》: {vocabulary} · 語彙《ごい》リンク: {rate}%",
  },
  "marumori.lastSync": { en: "Last Sync {when}", ja: "最終《さいしゅう》同期《どうき》 {when}" },
  "marumori.syncFailed": { en: "Last Sync failed: {error}", ja: "最終《さいしゅう》同期《どうき》は失敗《しっぱい》: {error}" },
  "marumori.syncFailedUnknown": {
    en: "Last Sync failed: unknown error",
    ja: "最終《さいしゅう》同期《どうき》は失敗《しっぱい》: 原因《げんいん》不明《ふめい》",
  },
  "marumori.apiKeyHeading": { en: "API key", ja: "APIキー" },
  "marumori.savedKey": { en: "Saved key", ja: "保存済《ほぞんず》みのキー" },
  "marumori.keySet": { en: "set", ja: "設定済《せっていず》み" },
  "marumori.replace": { en: "Replace", ja: "置《お》き換《か》える" },
  "marumori.keyLabel": { en: "MaruMori API key", ja: "MaruMoriのAPIキー" },
  "marumori.keyHint": {
    en: "Paste a new key to replace the saved one. The saved key is never shown.",
    ja: "新《あたら》しいキーを貼《は》ると保存済《ほぞんず》みのキーを置《お》き換《か》えます。保存済《ほぞんず》みのキーは表示《ひょうじ》されません。",
  },
  "marumori.saveKey": { en: "Save key", ja: "キーを保存《ほぞん》" },
  "marumori.keepKey": { en: "Keep the saved key", ja: "保存済《ほぞんず》みのキーを残《のこ》す" },
  "marumori.confirmRemove": { en: "Confirm remove", ja: "削除《さくじょ》を確定《かくてい》" },
  "marumori.removeKey": { en: "Remove key", ja: "キーを削除《さくじょ》" },
  "marumori.syncHeading": { en: "Sync", ja: "同期《どうき》" },
  "marumori.syncNow": { en: "Sync now", ja: "今《いま》すぐ同期《どうき》" },
  "marumori.hideRuns": { en: "Hide recent Syncs", ja: "最近《さいきん》の同期《どうき》を隠《かく》す" },
  "marumori.showRuns": { en: "Show recent Syncs", ja: "最近《さいきん》の同期《どうき》を表示《ひょうじ》" },
  "marumori.runsLoadFailed": {
    en: "Cannot load Sync history: {message}",
    ja: "同期《どうき》履歴《りれき》を読《よ》み込《こ》めません: {message}",
  },
  "marumori.noRuns": { en: "No Syncs yet.", ja: "まだ同期《どうき》はありません。" },
  "settings.savedTheme": {
    en: "Saved on this device. System follows your computer.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。システムはコンピュータの設定《せってい》に従《したが》います。",
  },
  "settings.japaneseFontLegend": { en: "Japanese font", ja: "日本語《にほんご》フォント" },
  "settings.fontSerif": { en: "Serif", ja: "明朝《みんちょう》" },
  "settings.fontSans": { en: "Sans", ja: "ゴシック" },
  "settings.savedFont": {
    en: "Saved on this device. Sans is plainer, with simpler strokes; it applies to all Japanese text.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。ゴシックは線《せん》が単純《たんじゅん》で、すべての日本語《にほんご》の文字《もじ》に適用《てきよう》されます。",
  },
  "settings.storySizeLegend": { en: "Story text size", ja: "物語《ものがたり》の文字《もじ》の大《おお》きさ" },
  "settings.saving": { en: "Saving…", ja: "保存中《ほぞんちゅう》…" },
  "settings.saved": { en: "Saved.", ja: "保存《ほぞん》しました。" },
  "settings.savedSize": {
    en: "Saved on this device. The size applies to Story text and the Reading Panel.",
    ja: "この端末《たんまつ》に保存《ほぞん》されます。大《おお》きさは物語《ものがたり》の本文《ほんぶん》と読解《どっかい》パネルに適用《てきよう》されます。",
  },

  // — The web Story reader chrome (issue #125 Part 2) —
  "reader.backToStories": { en: "Back to stories", ja: "物語《ものがたり》へ戻《もど》る" },
  "reader.hideTranslation": { en: "Hide translation", ja: "翻訳《ほんやく》を隠《かく》す" },
  "reader.showTranslation": { en: "Show translation", ja: "翻訳《ほんやく》を表示《ひょうじ》" },
  "reader.panelAria": { en: "Reading Panel", ja: "読解《どっかい》パネル" },
  "reader.wordMeaning": { en: "Word meaning", ja: "単語《たんご》の意味《いみ》" },
  "reader.panelHint": {
    en: "Select a sentence to read its translation. Hover or focus a word to see its meaning.",
    ja: "文《ぶん》を選《えら》ぶと訳《やく》が読《よ》めます。語《ことば》にホバーまたはフォーカスすると意味《いみ》が分《わか》ります。",
  },
  "reader.sentenceTranslationAria": { en: "Sentence Translation", ja: "文《ぶん》の訳《やく》" },
  "reader.translationHiddenNote": {
    en: "Translation hidden — click or press Enter to show",
    ja: "翻訳《ほんやく》は隠《かく》れています — クリックまたは Enter で表示《ひょうじ》",
  },
  "reader.blurSaveFailed": { en: "Could not save that — {message}", ja: "保存《ほぞん》できませんでした — {message}" },
  "reader.saveFailed": { en: "Could not save — {message}", ja: "保存《ほぞん》できません — {message}" },
  "reader.saveFailedListVanished": {
    en: "Could not save — the new list vanished",
    ja: "保存《ほぞん》できません — 新《あたら》しいリストが消《き》えました",
  },
  "reader.saveListsLoading": {
    en: "Could not save — Your Item Lists are still loading",
    ja: "保存《ほぞん》できません — リストの読《よ》み込《こ》み中《ちゅう》です",
  },
  "reader.savedToList": { en: "Saved to {list}.", ja: "{list}に保存《ほぞん》しました。" },
  "reader.savedToListYours": { en: "Saved to your list.", ja: "あなたのリストに保存《ほぞん》しました。" },
  "reader.wordMenuAria": { en: "Word menu", ja: "語《ことば》のメニュー" },
  "reader.dictionaryEntry": { en: "Dictionary Entry", ja: "辞書《じしょ》" },
  "reader.dictNoAnswer": {
    en: "The dictionary did not answer.",
    ja: "辞書《じしょ》が応答《おうとう》しませんでした",
  },
  "reader.grammarPoint": { en: "Grammar Point", ja: "文法《ぶんぽう》ポイント" },
  "reader.saveToDescription": {
    en: "Save the word or pattern to one of your lists.",
    ja: "この語《ことば》またはパターンをリストのどれかに保存《ほぞん》します。",
  },
  "reader.comprehension": { en: "Comprehension", ja: "理解《りかい》" },
  "reader.answerOption": { en: "Answer {n}: {option}", ja: "答《こた》え {n}: {option}" },
  "reader.correct": { en: "Correct.", ja: "正《ただ》しいです。" },
  "reader.notQuite": {
    en: "Not quite — the answer is above your selection.",
    ja: "惜《お》しい！答《こた》えは選《えら》んだ項目《こうもく》の上《うえ》にあります。",
  },
  "reader.prevStoryAria": { en: "Previous story", ja: "前《まえ》の物語《ものがたり》" },
  "reader.nextStoryAria": { en: "Next story", ja: "次《つぎ》の物語《ものがたり》" },
  "reader.unmarkReadAria": { en: "Unmark read", ja: "未読《みどく》に戻《もど》す" },
  "reader.read": { en: "Read", ja: "読《よ》んだ" },
  "reader.rateUpAria": { en: "Rate up", ja: "良《よ》い評価《ひょうか》" },
  "reader.rateDownAria": { en: "Rate down", ja: "悪《わる》い評価《ひょうか》" },
  "reader.practiceThis": { en: "Practice this Story", ja: "この物語《ものがたり》を練習《れんしゅう》" },
  "reader.newListName": { en: "New list name", ja: "新《あたら》しいリストの名前《なまえ》" },
  "reader.createAndSaveAria": { en: "Create a new list and save", ja: "新《あたら》しいリストを作《つく》って保存《ほぞん》" },
  "reader.create": { en: "Create", ja: "作《つく》る" },
  "reader.srs": { en: "SRS {level}", ja: "SRS {level}" },
  "reader.pitchHeiban": { en: "heiban (flat)", ja: "平板《へいばん》（フラット）" },
  "reader.pitchDownstep": { en: "downstep after mora {n}", ja: "モーラ{n}の落《お》ち目《め》" },

  // — The web Practice screen (issue #125 Part 2) —
  "practice.heading": { en: "Practice", ja: "練習《れんしゅう》" },
  "practice.building": {
    en: "Building your session from the Focus Set…",
    ja: "重点項目《じゅうてんこうもく》から練習《れんしゅう》を作《つく》っています…",
  },
  "practice.next": {
    en: "The next exercise is on its way…",
    ja: "次《つぎ》の問題《もんだい》を準備中《じゅんびちゅう》です…",
  },
  "practice.intro": {
    en: "A session is about twenty exercises drawn from your Focus Set, recognition and grammar cloze. Every answer feeds your mastery record.",
    ja: "1回《かい》の練習《れんしゅう》は重点項目《じゅうてんこうもく》から作《つく》る約《やく》20問《もん》。意味《いみ》を問《と》う問題《もんだい》と文法《ぶんぽう》の穴埋《うず》め問題《もんだい》です。答《こた》えはすべて習熟《しゅうじゅく》記録《きろく》に反映《はんえい》します。",
  },
  "practice.start": { en: "Start a practice session", ja: "練習《れんしゅう》を始《はじ》める" },
  "practice.empty": {
    en: "Nothing in your Focus Set to practise yet",
    ja: "練習《れんしゅう》できる重点項目《じゅうてんこうもく》はまだありません。",
  },
  "practice.openLists": { en: "Open your Item Lists", ja: "リストを開《ひら》く" },
  "practice.exerciseOf": { en: "Exercise {n} of {total}", ja: "{total}問《もん》中《ちゅう》{n}問目《もんめ》" },
  "practice.skipped": {
    en: "({count} Focus Set item{plural} without content, skipped)",
    ja: "（内容《ないよう》のない重点項目《じゅうてんこうもく》{count}件《けん》{plural}はスキップしました）",
  },
  "practice.progressAria": { en: "Practice Session progress", ja: "練習《れんしゅう》セッションの進《すす》み" },
  "practice.continue": { en: "Continue", ja: "続行《ぞくこう》" },
  "practice.correct": { en: "Correct", ja: "正《ただ》しい" },
  "practice.notQuite": { en: "Not quite", ja: "惜《お》しいです" },
  "practice.notQuiteAnswer": {
    en: "Not quite. Correct answer: {answer}",
    ja: "惜《お》しいです。正解《せいかい》: {answer}",
  },
  "practice.destinationGrammar": { en: "Open Grammar Point", ja: "文法《ぶんぽう》ポイントを開《ひら》く" },
  "practice.destinationLists": { en: "Open Item Lists", ja: "リストを開《ひら》く" },
  "practice.sessionComplete": { en: "Session complete", ja: "セッション完了《かんりょう》" },
  "practice.scoreLine": {
    en: "{correct} of {total} correct - {count} exercise{plural} from your Focus Set.",
    ja: "{total}問《もん》中《ちゅう》{correct}問《もん》正解《せいかい》です（重点項目《じゅうてんこうもく》から{count}問《もん》{plural}）。",
  },
  "practice.needsLook": { en: "Needs another look", ja: "見直《みなお》す" },
  "practice.correctAnswer": { en: "Correct answer: {answer}", ja: "正解《せいかい》: {answer}" },
  "practice.nothingToRevisit": {
    en: "Nothing to revisit this time.",
    ja: "今回《こんかい》、見直《みなお》す項目《こうもく》はありません。",
  },
  "practice.again": { en: "Practice again", ja: "もう一度《いちど》練習《れんしゅう》" },
  "item.kana": { en: "Kana", ja: "仮名《かな》" },
  "item.phrase": { en: "Phrase", ja: "フレーズ" },

  // The Grammar Catalogue (ui-plan 4.6, /grammar). JLPT levels (N5…N1) are data
  // and never translated; the level codes and MaruMori stay as-is in Japanese.
  "grammar.title": { en: "Grammar", ja: "文法《ぶんぽう》" },
  "grammar.loadFailed": {
    en: "Cannot load grammar points: {message}",
    ja: "文法《ぶんぽう》ポイントを読《よ》み込《こ》めません: {message}",
  },
  "grammar.noSearchMatch": {
    en: "Nothing matches “{query}” — try another word.",
    ja: "“{query}”に合《あ》う文法《ぶんぽう》ポイントはありません。他《ほか》のことばを試《ため》してみてください。",
  },
  "grammar.clearSearch": { en: "Clear search", ja: "検索《けんさく》をクリア" },
  "grammar.noLevelPoints": {
    en: "No {level} Grammar Points in the catalogue.",
    ja: "カタログに{level}の文法《ぶんぽう》ポイントはありません。",
  },
  "grammar.showAllLevels": { en: "Show all levels", ja: "すべてのレベルを表示《ひょうじ》" },
  "grammar.emptyCatalogue": {
    en: "No grammar points yet — a MaruMori sync fills this catalogue.",
    ja: "まだ文法《ぶんぽう》ポイントがありません。MaruMoriの同期《どうき》でカタログが埋《う》まります。",
  },
  "grammar.pointCount": {
    en: "{count} Grammar Point{plural}",
    ja: "文法《ぶんぽう》ポイント{count}件《けん》{plural}。",
  },
  "grammar.searchLabel": { en: "Search grammar", ja: "文法《ぶんぽう》を検索《けんさく》" },
  "grammar.searchPlaceholder": {
    en: "Search pattern or meaning",
    ja: "パターンまたは意味《いみ》を検索《けんさく》",
  },
  "grammar.clearSearchAria": { en: "Clear search term", ja: "検索《けんさく》ワードをクリア" },
  "grammar.levelsAria": { en: "JLPT Levels", ja: "JLPTレベル" },
  "grammar.allLevels": { en: "All levels", ja: "すべてのレベル" },
  "grammar.statusSeeded": { en: "Seeded", ja: "開始《かいし》レベルから推定《すいてい》" },
  "grammar.statusObserved": { en: "Observed", ja: "観察済《かんさつず》み" },
  "grammar.statusNotKnown": { en: "Not known", ja: "未知《みち》" },
  "grammar.pagesAria": { en: "Grammar pages", ja: "文法《ぶんぽう》ページ" },
  "grammar.pageRange": {
    en: "{from}–{to} of {total}",
    ja: "全《ぜん》{total}件《けん》の{from}〜{to}件目《けんめ》",
  },
  "grammar.exampleCount": { en: "{count} example{plural}", ja: "例文《れいぶん》{count}件《けん》{plural}" },
  "grammar.backAria": { en: "Back to grammar", ja: "文法《ぶんぽう》へ戻《もど》る" },
  "grammar.notCataloguePoint": {
    en: "This is not a grammar point from the catalogue.",
    ja: "これはカタログの文法《ぶんぽう》ポイントではありません。",
  },
  "grammar.detailLoadFailed": {
    en: "Cannot load this grammar point: {message}",
    ja: "この文法《ぶんぽう》ポイントを読《よ》み込《こ》めません: {message}",
  },
  "grammar.generating": {
    en: "Preparing this page — the tutor writes a Grammar Point’s explanation the first time it is opened.",
    ja: "このページは準備中《じゅんびちゅう》です — チューターは文法《ぶんぽう》ポイントの解説《せつめい》を、初《はじ》めて開《ひら》くときに書《か》きます。",
  },
  "grammar.explanation": { en: "Explanation", ja: "解説《せつめい》" },
  "grammar.explainFailed": {
    en: "The tutor could not generate this explanation. Check the AI Provider for grammar content in Settings, then reload this page.",
    ja: "チューターはこの解説《せつめい》を生成《せいせい》できませんでした。設定《せってい》で文法《ぶんぽう》コンテンツのAIプロバイダーを確認《かくにん》し、このページを読《よ》み直《なお》してください。",
  },
  "grammar.reload": { en: "Reload", ja: "読《よ》み直《なお》す" },
  "grammar.examples": { en: "Example sentences", ja: "例文《れいぶん》" },
  "grammar.noValidatedExamples": {
    en: "No validated examples yet.",
    ja: "検証済《けんしょうず》みの例文《れいぶん》はまだありません。",
  },
  // The Item Lists section (issue #12's management): master/detail, membership,
  // and the Default/Boosting choices. "Saved" and the level of the built-in list
  // follow the section's terminology (リスト, 優先, 重点項目).
  "settings.listsLoadFailed": {
    en: "Cannot load your Item Lists: {message}",
    ja: "あなたのリストを読《よ》み込《こ》めません: {message}",
  },
  "lists.introNote": {
    en: "Saving a word from a story adds it to the Default List. A Boosting List also pulls its not-yet-known items into your stories’ Focus Sets. Choose a list to manage its items.",
    ja: "物語《ものがたり》から単語《たんご》を保存《ほぞん》すると、既定《きてい》のリストに追加《ついか》されます。優先《ゆうせん》リストは、まだ知《し》らない項目《こうもく》を物語《ものがたり》の重点項目《じゅうてんこうもく》にも追加《ついか》します。リストを選《えら》んで項目《こうもく》を管理《かんり》してください。",
  },
  "lists.yourLists": { en: "Your lists", ja: "あなたのリスト" },
  "lists.empty": { en: "No lists yet.", ja: "まだリストがありません。" },
  "lists.manage": { en: "Manage", ja: "管理《かんり》" },
  "lists.addHeading": { en: "Add a list", ja: "リストを追加《ついか》" },
  "lists.nameLabel": { en: "List name", ja: "名前《なまえ》" },
  "lists.namePlaceholder": { en: "food, travel…", ja: "食《た》べ物《もの》、旅行《りょこう》…" },
  "lists.addSubmit": { en: "Add list", ja: "リストを追加《ついか》" },
  "lists.back": { en: "Back to all lists", ja: "すべてのリストへ" },
  "lists.renameLabel": { en: "New name", ja: "新《あたら》しい名前《なまえ》" },
  "lists.saveName": { en: "Save name", ja: "名前《なまえ》を保存《ほぞん》" },
  "lists.boostingLabel": { en: "Boosting", ja: "優先《ゆうせん》" },
  "lists.boostingHint": {
    en: "Push not-yet-known items into Focus Sets.",
    ja: "まだ知《し》らない項目《こうもく》を重点項目《じゅうてんこうもく》に追加《ついか》します。",
  },
  "lists.defaultNote": {
    en: "This is the Default List: a Save from a story goes here.",
    ja: "これは既定《きてい》のリストです: 物語《ものがたり》での保存《ほぞん》はここに収《おさ》まります。",
  },
  "lists.makeDefault": { en: "Make default", ja: "既定《きてい》に設定《せってい》" },
  "lists.deleteList": { en: "Delete list", ja: "リストを削除《さくじょ》" },
  "lists.savedNote": {
    en: "Saved is built in: it can be configured, not renamed or deleted.",
    ja: "保存《ほぞん》リストは組《く》み込《こ》みです。設定《せってい》はできますが、名前《なまえ》の変更《へんこう》や削除《さくじょ》はできません。",
  },
  "lists.itemsHeading": { en: "Items ({count})", ja: "項目《こうもく》 ({count})" },
  "lists.itemsEmpty": { en: "No items yet.", ja: "まだ項目《こうもく》がありません。" },
  "lists.removeAria": { en: "Remove {surface}", ja: "{surface}を削除《さくじょ》" },
  "lists.addItemHeading": { en: "Add an item", ja: "項目《こうもく》を追加《ついか》" },
  "lists.kindLegend": { en: "Kind", ja: "種類《しゅるい》" },
  "lists.refLabel": {
    en: "Reference (dictionary entry sequence or grammar point id)",
    ja: "参照《さんしょう》 (辞書《じしょ》エントリ番号《ばんごう》または文法《ぶんぽう》ポイント id)",
  },
  "lists.kanjiRefHint": {
    en: "For a Kanji, type the character itself.",
    ja: "漢字《かんじ》は字《じ》そのものを入力《にゅうりょく》してください。",
  },
  "lists.addToSubmit": { en: "Add to list", ja: "リストに追加《ついか》" },
  "lists.added": { en: "Added.", ja: "追加《ついか》しました。" },
  // The AI Providers section (issue #5): the provider list, the endpoint form
  // and the per-task assignment. Provider names, server messages and latencies
  // ride through as {placeholder} values.
  "ai.loadFailed": {
    en: "Cannot load settings: {message}",
    ja: "設定《せってい》を読《よ》み込《こ》めません: {message}",
  },
  "ai.saved": { en: "Provider saved.", ja: "AIプロバイダーを保存《ほぞん》しました。" },
  "ai.added": { en: "Provider added.", ja: "AIプロバイダーを追加《ついか》しました。" },
  "ai.deleted": { en: "Provider deleted.", ja: "AIプロバイダーを削除《さくじょ》しました。" },
  "ai.assignmentSaved": { en: "Assignment saved.", ja: "割当《わりあて》を保存《ほぞん》しました。" },
  "ai.formIncomplete": {
    en: "Fill in the name, base URL and model, or leave the step.",
    ja: "名前《なまえ》、ベースURL、モデルを入力《にゅうりょく》するか、このステップを空《から》にしてください。",
  },
  "ai.providersHeading": { en: "Providers", ja: "AIプロバイダー" },
  "ai.empty": {
    en: "No providers yet. Add an OpenAI-compatible endpoint below.",
    ja: "AIプロバイダーはまだありません。下《した》にOpenAI互換《ごかん》のエンドポイントを追加《ついか》してください。",
  },
  "ai.editButton": { en: "Edit {name}", ja: "{name}を編集《へんしゅう》" },
  "ai.testing": { en: "Testing…", ja: "テスト中《ちゅう》…" },
  "ai.testButton": { en: "Test connection to {name}", ja: "{name}との接続《せつぞく》をテスト" },
  "ai.deleteButton": { en: "Delete {name}", ja: "{name}を削除《さくじょ》" },
  "ai.testResult": { en: "{message} ({latency} ms)", ja: "{message}（{latency} ms）" },
  "ai.editHeading": { en: "Edit {name}", ja: "{name}を編集《へんしゅう》" },
  "ai.addHeading": { en: "Add a provider", ja: "AIプロバイダーを追加《ついか》" },
  "ai.nameLabel": { en: "Name", ja: "名前《なまえ》" },
  "ai.baseUrlLabel": { en: "Base URL", ja: "ベースURL" },
  "ai.baseUrlPlaceholder": {
    en: "https://api.openai.com/v1 or http://localhost:11434",
    ja: "https://api.openai.com/v1 または http://localhost:11434",
  },
  "ai.modelLabel": { en: "Model", ja: "モデル" },
  "ai.keySet": { en: "API key set", ja: "APIキーを設定済《せっていず》み" },
  "ai.newKeyLabel": { en: "New API key", ja: "新《あたら》しいAPIキー" },
  "ai.keyHintKeep": {
    en: "Leave empty to keep the saved key.",
    ja: "空《から》にすると保存済《ほぞんず》みのキーが保《たも》たれます。",
  },
  "ai.keyHintNone": {
    en: "Leave empty if the endpoint needs none.",
    ja: "エンドポイントにキーが不要《ふよう》なら空《から》にしてください。",
  },
  "ai.removeKeyLabel": { en: "Remove the saved key", ja: "保存済《ほぞんず》みのキーを削除《さくじょ》" },
  "ai.removeKeyNote": {
    en: "The saved key will be removed when you save.",
    ja: "保存《ほぞん》すると、保存済《ほぞんず》みのキーは削除《さくじょ》されます。",
  },
  "ai.saveChanges": { en: "Save changes", ja: "変更《へんこう》を保存《ほぞん》" },
  "ai.addSubmit": { en: "Add provider", ja: "AIプロバイダーを追加《ついか》" },
  "ai.assignmentHeading": { en: "Which provider to use", ja: "使《つか》うAIプロバイダー" },
  "common.none": { en: "None", ja: "なし" },
  "common.close": { en: "Close", ja: "閉《と》じる" },
  "common.rename": { en: "Rename", ja: "名前《なまえ》の変更《へんこう》" },
  "common.remove": { en: "Remove", ja: "削除《さくじょ》" },
  "common.confirmDelete": { en: "Confirm delete", ja: "削除《さくじょ》を確定《かくてい》" },

  "grammar.alsoWritten": {
    en: "Also written {variants}",
    ja: "他《ほか》には{variants}とも書《か》かれます",
  },
} as const satisfies Record<string, { en: string; ja: string }>;

/** Every table entry key — the type-checked union `keyof typeof strings`. */
export type StringKey = keyof typeof strings;
